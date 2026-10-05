import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Account Model
class TeleAccount {
  final String phone;
  String name;
  bool isRunning;
  int dmsToday;
  int dmsTotal;
  String status; // 'Active', 'Standby', 'FloodWait', 'Resting', 'awaiting_otp'
  int? floodWaitRemainingSec;
  List<String> liveLogs;

  TeleAccount({
    required this.phone,
    required this.name,
    this.isRunning = false,
    this.dmsToday = 0,
    this.dmsTotal = 0,
    this.status = 'Standby',
    this.floodWaitRemainingSec,
    List<String>? liveLogs,
  }) : liveLogs = liveLogs ?? [];
}

/// Global Master Configuration & State Controller
class TeleBotState extends ChangeNotifier {
  // Theme State: Day / Night
  bool _isDarkMode = true;
  bool get isDarkMode => _isDarkMode;

  // Active Bottom Tab (0 = Home/Overview, 1 = Accounts Fleet & ID Logs, 2 = Master Config & Settings)
  int _activeTabIndex = 0;
  int get activeTabIndex => _activeTabIndex;

  // Global Master Running State
  bool _isGlobalRunning = false;
  bool get isGlobalRunning => _isGlobalRunning;

  // Dynamic DM & Live Stream Engine Status
  bool _isDynamicDmActive = true;
  bool get isDynamicDmActive => _isDynamicDmActive;

  bool _isVoiceListenerActive = true;
  bool get isVoiceListenerActive => _isVoiceListenerActive;

  // Parallel Active Slots Limit (Minimum 10 parallel accounts)
  int _parallelActiveSlots = 10;
  int get parallelActiveSlots => _parallelActiveSlots;

  // Safe DM Delays
  int _delayMinSec = 35;
  int get delayMinSec => _delayMinSec;
  int _delayMaxSec = 65;
  int get delayMaxSec => _delayMaxSec;

  // Target Channel Link & Message Template
  String _targetChannelLink = 'https://t.me/earn_with_nikhil';
  String get targetChannelLink => _targetChannelLink;

  String _currentSpintaxMessage =
      'Hello {bhai|sir|dost}! Live stream me aapka message dekha. Official VIP giveaway access link: https://t.me/earn_with_nikhil';
  String get currentSpintaxMessage => _currentSpintaxMessage;

  // Lead Filters
  bool _filterRejectBots = true;
  bool get filterRejectBots => _filterRejectBots;
  bool _filterRejectAdmins = true;
  bool get filterRejectAdmins => _filterRejectAdmins;
  bool _filterAllowSilent = true;
  bool get filterAllowSilent => _filterAllowSilent;
  bool _filterRejectPremium = false;
  bool get filterRejectPremium => _filterRejectPremium;

  // VPS Connection Config
  String _vpsUrl = 'https://bot10.xyz';
  String get vpsUrl => _vpsUrl;

  String _authToken = '';
  String get authToken => _authToken;

  bool _isConnectedToVps = false;
  bool get isConnectedToVps => _isConnectedToVps;

  String _connectionStatusText = 'Connected to VPS ✅';
  String get connectionStatusText => _connectionStatusText;

  // Selected account index for logs
  int _selectedAccountIndex = 0;
  int get selectedAccountIndex => _selectedAccountIndex;

  // Accounts List
  List<TeleAccount> _accounts = [
    TeleAccount(
      phone: '+1 (202) 555-0143',
      name: 'Slot 01 - Sandra',
      isRunning: false,
      dmsToday: 38,
      dmsTotal: 184,
      status: 'Standby',
      liveLogs: [
        '[INIT] MTProto session active.',
        '[RADAR] Live voice chat listener connected.',
        '[DM] 🚀 Message delivered to @RahulSharma | Daily: 38',
      ],
    ),
  ];
  List<TeleAccount> get accounts => _accounts;

  TeleAccount get selectedAccount => _selectedAccountIndex < _accounts.length
      ? _accounts[_selectedAccountIndex]
      : (_accounts.isNotEmpty ? _accounts.first : TeleAccount(phone: 'none', name: 'No Accounts'));

  // Constructor
  TeleBotState() {
    _startParallelDispatcherSimulation();
  }

  // Toggle Day / Night Mode
  void toggleTheme() {
    _isDarkMode = !_isDarkMode;
    notifyListeners();
  }

  // Set Active Tab
  void setTab(int index) {
    _activeTabIndex = index;
    notifyListeners();
  }

  // Select Account
  void selectAccount(int index) {
    if (index >= 0 && index < _accounts.length) {
      _selectedAccountIndex = index;
      notifyListeners();
    }
  }

  Map<String, String> _getHeaders() {
    final headers = <String, String>{
      'Content-Type': 'application/json',
    };
    if (_authToken.isNotEmpty) {
      headers['Authorization'] = 'Bearer $_authToken';
    }
    return headers;
  }

  // 1. MASTER GLOBAL BOT TOGGLE (Start All / Stop All)
  Future<bool> toggleGlobalMaster() async {
    _isGlobalRunning = !_isGlobalRunning;
    final targetRunning = _isGlobalRunning;

    for (var acc in _accounts) {
      acc.isRunning = targetRunning;
      acc.status = targetRunning ? 'Active' : 'Standby';
    }
    notifyListeners();

    // Notify VPS Backend
    if (_vpsUrl.isNotEmpty) {
      try {
        final endpoint = targetRunning ? '$_vpsUrl/api/user/bulk-action' : '$_vpsUrl/api/stop-all';
        final body = targetRunning
            ? jsonEncode({'action': 'start_all', 'phones': _accounts.map((a) => a.phone).toList()})
            : jsonEncode({});

        await http.post(
          Uri.parse(endpoint),
          headers: _getHeaders(),
          body: body,
        ).timeout(const Duration(seconds: 6));
      } catch (e) {
        debugPrint('VPS bulk toggle error: $e');
      }
    }
    return true;
  }

  // 2. INDIVIDUAL ACCOUNT TOGGLE (Start / Stop)
  Future<bool> toggleAccount(int index) async {
    if (index < 0 || index >= _accounts.length) return false;
    final acc = _accounts[index];
    acc.isRunning = !acc.isRunning;
    acc.status = acc.isRunning ? 'Active' : 'Standby';
    notifyListeners();

    if (_vpsUrl.isNotEmpty) {
      try {
        final endpoint = acc.isRunning ? '$_vpsUrl/api/account/start' : '$_vpsUrl/api/account/stop';
        await http.post(
          Uri.parse(endpoint),
          headers: _getHeaders(),
          body: jsonEncode({'phone': acc.phone}),
        ).timeout(const Duration(seconds: 6));
      } catch (e) {
        debugPrint('VPS single account toggle error: $e');
      }
    }
    return true;
  }

  // 3. DYNAMIC DM TOGGLE
  Future<bool> toggleDynamicDm() async {
    _isDynamicDmActive = !_isDynamicDmActive;
    notifyListeners();

    if (_vpsUrl.isNotEmpty) {
      try {
        await http.post(
          Uri.parse('$_vpsUrl/api/account/toggle-dm'),
          headers: _getHeaders(),
          body: jsonEncode({'enabled': _isDynamicDmActive}),
        ).timeout(const Duration(seconds: 5));
      } catch (e) {
        debugPrint('Toggle DM error: $e');
      }
    }
    return true;
  }

  // 4. VOICE LISTENER TOGGLE
  Future<bool> toggleVoiceListener() async {
    _isVoiceListenerActive = !_isVoiceListenerActive;
    notifyListeners();

    if (_vpsUrl.isNotEmpty) {
      try {
        await http.post(
          Uri.parse('$_vpsUrl/api/account/toggle-live'),
          headers: _getHeaders(),
          body: jsonEncode({'enabled': _isVoiceListenerActive}),
        ).timeout(const Duration(seconds: 5));
      } catch (e) {
        debugPrint('Toggle Voice Hook error: $e');
      }
    }
    return true;
  }

  // 5. ADD TELEGRAM ACCOUNT (OTP FLOW)
  Future<Map<String, dynamic>> addAccountRequestOtp({required String phone, required String label}) async {
    if (_vpsUrl.isEmpty) {
      return {'success': false, 'msg': 'Please connect to VPS first!'};
    }
    try {
      final res = await http.post(
        Uri.parse('$_vpsUrl/api/account/add'),
        headers: _getHeaders(),
        body: jsonEncode({
          'phone': phone.trim(),
          'label': label.trim(),
        }),
      ).timeout(const Duration(seconds: 15));

      final data = jsonDecode(res.body);
      if (data is Map<String, dynamic>) {
        // Also auto-refresh accounts list
        syncAccountsFromVps();
        return data;
      }
      return {'success': true, 'msg': 'OTP Code requested from Telegram!'};
    } catch (e) {
      return {'success': false, 'msg': 'Failed to request OTP: $e'};
    }
  }

  // 6. VERIFY TELEGRAM OTP
  Future<Map<String, dynamic>> verifyOtp({required String phone, required String code}) async {
    if (_vpsUrl.isEmpty) {
      return {'success': false, 'msg': 'Please connect to VPS first!'};
    }
    try {
      final res = await http.post(
        Uri.parse('$_vpsUrl/api/account/verify-otp'),
        headers: _getHeaders(),
        body: jsonEncode({
          'phone': phone.trim(),
          'code': code.trim(),
        }),
      ).timeout(const Duration(seconds: 25));

      final data = jsonDecode(res.body);
      syncAccountsFromVps();
      if (data is Map<String, dynamic>) {
        return data;
      }
      return {'success': true, 'msg': 'OTP verification submitted!'};
    } catch (e) {
      return {'success': false, 'msg': 'OTP verification error: $e'};
    }
  }

  // 7. VERIFY 2FA CLOUD PASSWORD
  Future<Map<String, dynamic>> verify2FA({required String phone, required String password}) async {
    if (_vpsUrl.isEmpty) {
      return {'success': false, 'msg': 'Please connect to VPS first!'};
    }
    try {
      final res = await http.post(
        Uri.parse('$_vpsUrl/api/account/verify-2fa'),
        headers: _getHeaders(),
        body: jsonEncode({
          'phone': phone.trim(),
          'password': password.trim(),
        }),
      ).timeout(const Duration(seconds: 20));

      final data = jsonDecode(res.body);
      syncAccountsFromVps();
      if (data is Map<String, dynamic>) {
        return data;
      }
      return {'success': true, 'msg': '2FA verification submitted!'};
    } catch (e) {
      return {'success': false, 'msg': '2FA verification error: $e'};
    }
  }

  // 8. REMOVE ACCOUNT
  Future<bool> removeAccount(String phone) async {
    try {
      _accounts.removeWhere((a) => a.phone == phone);
      notifyListeners();

      if (_vpsUrl.isNotEmpty) {
        await http.post(
          Uri.parse('$_vpsUrl/api/account/remove'),
          headers: _getHeaders(),
          body: jsonEncode({'phone': phone}),
        ).timeout(const Duration(seconds: 6));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // 9. SAVE MASTER CONFIGURATION TO VPS
  Future<bool> saveMasterConfigToVps({
    String? channelLink,
    String? spintax,
    int? parallelSlots,
    int? minDelay,
    int? maxDelay,
    bool? rejectBots,
    bool? rejectAdmins,
    bool? allowSilent,
    bool? rejectPremium,
  }) async {
    if (channelLink != null) _targetChannelLink = channelLink;
    if (spintax != null) _currentSpintaxMessage = spintax;
    if (parallelSlots != null) _parallelActiveSlots = parallelSlots;
    if (minDelay != null) _delayMinSec = minDelay;
    if (maxDelay != null) _delayMaxSec = maxDelay;
    if (rejectBots != null) _filterRejectBots = rejectBots;
    if (rejectAdmins != null) _filterRejectAdmins = rejectAdmins;
    if (allowSilent != null) _filterAllowSilent = allowSilent;
    if (rejectPremium != null) _filterRejectPremium = rejectPremium;
    notifyListeners();

    if (_vpsUrl.isNotEmpty) {
      try {
        final payload = {
          'target_channel': _targetChannelLink,
          'spintax_template': _currentSpintaxMessage,
          'parallel_slots': _parallelActiveSlots,
          'min_delay': _delayMinSec,
          'max_delay': _delayMaxSec,
          'dynamic_dm_enabled': _isDynamicDmActive,
          'voice_stream_enabled': _isVoiceListenerActive,
          'filter_reject_bots': _filterRejectBots,
          'filter_reject_admins': _filterRejectAdmins,
          'filter_allow_silent': _filterAllowSilent,
          'filter_reject_premium': _filterRejectPremium,
        };

        final res = await http.post(
          Uri.parse('$_vpsUrl/api/account/config'),
          headers: _getHeaders(),
          body: jsonEncode(payload),
        ).timeout(const Duration(seconds: 8));

        return res.statusCode == 200;
      } catch (e) {
        debugPrint('Save config error: $e');
        return false;
      }
    }
    return true;
  }

  // SPINTAX PREVIEW GENERATOR
  String generateSpintaxPreview() {
    final regex = RegExp(r'\{([^{}]+)\}');
    final random = Random();
    return _currentSpintaxMessage.replaceAllMapped(regex, (match) {
      final options = match.group(1)!.split('|');
      return options[random.nextInt(options.length)].trim();
    });
  }

  // SYNC ACCOUNTS FROM VPS
  Future<bool> syncAccountsFromVps() async {
    if (_vpsUrl.isEmpty) return false;
    try {
      final res = await http.get(
        Uri.parse('$_vpsUrl/api/accounts'),
        headers: _getHeaders(),
      ).timeout(const Duration(seconds: 8));

      if (res.statusCode == 200) {
        final parsed = jsonDecode(res.body);
        if (parsed is List) {
          _accounts = parsed.map<TeleAccount>((item) {
            final isRunning = item['status'] == 'listening' || item['status'] == 'broadcasting' || item['status'] == 'online' || item['running'] == true;
            return TeleAccount(
              phone: item['phone']?.toString() ?? '',
              name: item['label']?.toString() ?? item['phone']?.toString() ?? 'ID',
              isRunning: isRunning,
              dmsToday: item['daily_sent_count'] is int ? item['daily_sent_count'] : 0,
              dmsTotal: item['sent_count'] is int ? item['sent_count'] : 0,
              status: (item['status']?.toString() ?? 'Standby'),
              liveLogs: [
                '[SYNC] Connected to VPS (${_vpsUrl})',
                if (isRunning) '[STATUS] Active MTProto worker firing live.'
              ],
            );
          }).toList();
        }
        _isConnectedToVps = true;
        _connectionStatusText = 'Connected to VPS ✅ (${_accounts.length} Accounts)';
        notifyListeners();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // VPS LOGIN & CONNECT
  Future<bool> connectAndSyncVPS(String url, {String? username, String? password}) async {
    _vpsUrl = url.trim().replaceAll(RegExp(r'/+$'), '');
    _connectionStatusText = 'Connecting to VPS...';
    notifyListeners();

    try {
      if (username != null && username.isNotEmpty && password != null && password.isNotEmpty) {
        final loginRes = await http.post(
          Uri.parse('$_vpsUrl/api/login'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'username': username, 'password': password}),
        ).timeout(const Duration(seconds: 8));

        if (loginRes.statusCode == 200) {
          final loginData = jsonDecode(loginRes.body);
          if (loginData['token'] != null) {
            _authToken = loginData['token'];
          }
        }
      }

      final success = await syncAccountsFromVps();
      if (!success) {
        _connectionStatusText = 'Connected, but 0 accounts returned.';
        notifyListeners();
      }
      return true;
    } catch (e) {
      _connectionStatusText = 'VPS Connection Failed: $e';
      notifyListeners();
      return false;
    }
  }

  // Background Worker Simulation
  Timer? _workerTimer;
  void _startParallelDispatcherSimulation() {
    _workerTimer = Timer.periodic(const Duration(seconds: 4), (timer) {
      if (!_isGlobalRunning && !_isDynamicDmActive) return;

      final activePool = _accounts.where((a) => a.isRunning).take(_parallelActiveSlots).toList();
      if (activePool.isEmpty) return;

      final randomAccount = activePool[Random().nextInt(activePool.length)];
      randomAccount.dmsToday += 1;
      randomAccount.dmsTotal += 1;

      final now = DateTime.now();
      final timeStr = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}';
      
      final sampleTarget = '@User_${1000 + Random().nextInt(8999)}';
      randomAccount.liveLogs.insert(
        0,
        '[$timeStr] 🚀 [DM SENT] Slot #${activePool.indexOf(randomAccount) + 1} delivered to $sampleTarget (Daily: ${randomAccount.dmsToday})',
      );
      if (randomAccount.liveLogs.length > 80) randomAccount.liveLogs.removeLast();

      notifyListeners();
    });
  }

  @override
  void dispose() {
    _workerTimer?.cancel();
    super.dispose();
  }
}
