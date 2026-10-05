// ---------------- START SERVER ----------------
// Load local primary cache instantly
loadUsersLocal();
ensureAdminUser();
loadAccountsLocal();
loadSlotRequestsLocal();
loadAccessRequestsLocal();
loadApiPoolLocal();
loadBotsVaultLocal();
loadChannelReactionsLocal();

// Bind and listen immediately on port
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Dashboard: http://0.0.0.0:${PORT}`);
  console.log(`Admin Panel: http://0.0.0.0:${PORT}/admin`);
});

(async () => {
  try {
    await loadUsers();
    await loadAccounts();
    syncUserRegisteredPhones();
    await loadSlotRequests();
    await loadAccessRequests();
    await loadApiPool();
    autoSyncAllUsersIntoBilling();
    console.log('[STARTUP KHATABOOK]: Auto-synced all existing users and bot owners into Khatabook ledger.');
  } catch (err) {
    console.error('[STARTUP BACKGROUND SYNC]:', err);
  }

  // Start background bot listener & midnight/expiry automations
  startTelegramPollerLoop();
  startMidnightAndExpirySchedulerLoop();
  startChannelReactionMonitorLoop();

  // 🛡️ UNINTERRUPTED AUTO-RESUME: Automatically restart all bots that were running before server/PM2 restart!
  autoResumeRunningBotsOnStartup().catch((err) => {
    console.error('[AUTO-RESUME ERROR]:', err);
  });
})();


//# sourceURL=file:///app/applet/server.ts