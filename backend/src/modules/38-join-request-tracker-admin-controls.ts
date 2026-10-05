// ---------------- JOIN REQUEST TRACKER ADMIN CONTROLS ----------------
app.post('/api/admin/join-tracker/reset', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ msg: 'Admin access required' });
  const username = (req.body?.username || '').trim();
  if (username) {
    dailyJoinHistory[username] = {};
    saveDailyJoinHistoryDebounced();
    res.json({ success: true, msg: `Join request stats reset successfully for ${username}.` });
  } else {
    dailyJoinHistory = {};
    saveDailyJoinHistoryDebounced();
    res.json({ success: true, msg: 'All users join request stats reset successfully.' });
  }
});

app.post('/api/admin/join-tracker/regenerate-link', async (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ msg: 'Admin access required' });
  const username = (req.body?.username || '').trim();
  if (!username) return res.status(400).json({ msg: 'Username required' });
  delete userTrackedLinks[username];
  saveUserTrackedLinks();
  const newL = await getOrCreateUserTrackedInviteLink(username);
  res.json({ success: true, link: newL, msg: `New tracked join link generated for ${username}: ${newL}` });
});

