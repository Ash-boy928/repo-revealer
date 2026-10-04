// ---------------- FORGOT PASSWORD ----------------
app.get('/api/forgot/question', (req         , res          ) => {
  const uname = String(req.query.username || '').trim();
  const u = getUser(uname);
  if (!u) return res.status(404).json({ msg: 'This username does not exist!' });
  if (!u.security_question) {
    return res.status(404).json({ msg: 'No security question set for this user! Ask admin to reset your password.' });
  }
  res.json({ question: u.security_question });
});

app.post('/api/forgot/reset', (req         , res          ) => {
  const { username, answer, new_password } = req.body || {};
  const uname = (username || '').trim();
  const ans = (answer || '').trim().toLowerCase();
  const nextPwd = (new_password || '').trim();

  const u = getUser(uname);
  if (!u) return res.status(404).json({ msg: 'This username does not exist!' });
  if (!u.security_answer) {
    return res.status(404).json({ msg: 'No security question set for this user! Ask admin to reset.' });
  }
  if (!verifyVal(u.security_answer, ans)) {
    return res.status(401).json({ msg: 'Wrong answer! Try again.' });
  }
  if (nextPwd.length < 6) {
    return res.json({ msg: 'New password must be at least 6 characters!' });
  }

  u.password = hashVal(nextPwd);
  saveUsers();
  res.json({ msg: 'Password reset successful! Now login with your new password.' });
});

