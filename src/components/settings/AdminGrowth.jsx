import { useEffect, useState } from 'react';

const PERIODS = [['week', '7 days'], ['month', '30 days'], ['total', 'All time']];

// Settings → Admin → Growth: are invite and song links being used, and do
// they turn into friendships? Totals only; nothing per person.
export function AdminGrowth() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/stats', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError('Could not load the numbers'));
  }, []);

  if (error) return <p className="growth-note">{error}</p>;
  if (!data) return <p className="growth-note">Loading…</p>;

  const ev = (name) => data.events[name] ?? {};
  const fr = (source) => data.friendships[source] ?? {};
  const sumFr = (key) => Object.values(data.friendships).reduce((n, r) => n + (r[key] ?? 0), 0);
  const per = (key) => ({ week: sumFr(`${key}_week`), month: sumFr(`${key}_month`), total: sumFr(`${key}_total`) });
  const frBy = (source, key) => ({ week: fr(source)[`${key}_week`], month: fr(source)[`${key}_month`], total: fr(source)[`${key}_total`] });

  const groups = [
    ['People', [
      ['New accounts', data.users],
      ['…from an invite link', ev('signup_invite')],
      ['…from a song link', ev('signup_share')],
    ]],
    ['Links', [
      ['Song links made', ev('share_created')],
      ['Song links opened', ev('share_opened')],
      ['Invite links opened', ev('invite_opened')],
    ]],
    ['Friend requests', [
      ['Sent', per('requests')],
      ['…from a song link', frBy('share', 'requests')],
      ['…from an invite link', frBy('invite', 'requests')],
      ['…by typing a code', frBy('code', 'requests')],
      ['Accepted', per('accepted')],
      ['…from a song link', frBy('share', 'accepted')],
      ['…from an invite link', frBy('invite', 'accepted')],
    ]],
  ];

  return (
    <div className="growth">
      <p className="growth-headline">
        <strong>{data.users.with_friend}</strong> of {data.users.total} people have at least one friend
      </p>
      <table className="growth-table">
        <thead>
          <tr><th />{PERIODS.map(([k, label]) => <th key={k}>{label}</th>)}</tr>
        </thead>
        {groups.map(([title, rows]) => (
          <tbody key={title}>
            <tr className="growth-group"><th colSpan={4}>{title}</th></tr>
            {rows.map(([label, v], i) => (
              <tr key={i} className={label.startsWith('…') ? 'growth-sub' : ''}>
                <th>{label}</th>
                {PERIODS.map(([k]) => <td key={k}>{v?.[k] ?? 0}</td>)}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="growth-note">
        Link and sign-up counts started Nov 2026. Older friend requests don't have a source, and
        removed friendships aren't counted.
      </p>
    </div>
  );
}
