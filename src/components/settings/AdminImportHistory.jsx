import { useEffect, useRef, useState } from 'react';

const STATUS_LABEL = { added: 'Added', replaced: 'Replaced', skipped: 'Skipped', failed: 'Failed' };

// Admin → Import History. Upload a CSV (date, sender, receiver, link) to
// backfill past swaps. The server looks up each link in the background; this
// polls until it's done, then lists what happened to every row.
export function AdminImportHistory() {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;
    let stop = false, timer;
    const poll = async () => {
      const r = await fetch(`/api/admin/history/import/${jobId}`, { credentials: 'include' }).catch(() => null);
      if (stop) return;
      const d = await r?.json().catch(() => ({}));
      if (!r?.ok) { setError(d?.error || 'Lost track of the import'); setJobId(null); return; }
      setJob(d);
      if (d.status === 'running') timer = setTimeout(poll, 1500);
      else setJobId(null);
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [jobId]);

  const upload = async () => {
    setError(''); setJob(null);
    const r = await fetch('/api/admin/history/import', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'text/csv' },
      body: await file.text(),
    }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (!r?.ok) { setError(d?.error || 'Upload failed'); return; }
    setJobId(d.id);
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const running = !!jobId;
  const notAdded = job?.rows?.filter(r => r.status !== 'added') ?? [];

  return (
    <div className="settings-password-form">
      <p className="settings-hint">
        CSV with a header row naming the columns, in any order: <code>to, from, links, dateTime</code>{' '}
        (or <code>receiver, sender, link, date</code>). Times without a time zone use the app's time zone. When a song is already in that pair's history, the older copy wins.
      </p>
      <input ref={inputRef} type="file" accept=".csv,text/csv" disabled={running}
        onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); }} />
      <button className="settings-save-btn" disabled={!file || running} onClick={upload}>
        {running ? 'Importing…' : 'Import'}
      </button>
      {error && <p className="settings-feedback error">{error}</p>}

      {job?.status === 'running' && (
        <p className="settings-feedback">Looking up songs… {job.processed} / {job.total}</p>
      )}
      {job && job.status !== 'running' && (
        <>
          <p className={`settings-feedback ${job.status === 'failed' ? 'error' : 'success'}`}>
            {job.error || 'Import finished.'} {job.summary.added} added, {job.summary.replaced} replaced,{' '}
            {job.summary.skipped} skipped, {job.summary.failed} failed.
          </p>
          {notAdded.length > 0 && (
            <details className="import-report">
              <summary>Rows not simply added ({notAdded.length})</summary>
              <ul>
                {notAdded.map(r => (
                  <li key={r.row}>
                    <strong>Row {r.row}</strong> · {STATUS_LABEL[r.status] ?? r.status}
                    {r.title && <> · {r.title}{r.artist && ` — ${r.artist}`}</>}
                    {r.message && <> · <span className="settings-hint">{r.message}</span></>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
