import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'app_logo_data.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0C131D),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const LeoTeleBotApp());
}

class LeoTeleBotApp extends StatelessWidget {
  const LeoTeleBotApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LeoTeleBot',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0C131D),
        primaryColor: const Color(0xFF00B0FF),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF00B0FF),
          secondary: Color(0xFF38BDF8),
          surface: Color(0xFF121C2C),
        ),
        fontFamily: 'sans-serif',
      ),
      home: const LeoTeleBotShellScreen(),
    );
  }
}

class LeoTeleBotShellScreen extends StatefulWidget {
  const LeoTeleBotShellScreen({super.key});

  @override
  State<LeoTeleBotShellScreen> createState() => _LeoTeleBotShellScreenState();
}

class _LeoTeleBotShellScreenState extends State<LeoTeleBotShellScreen> {
  static const String _defaultVpsUrl = 'https://bot10.xyz';
  static const String _prefKeyVpsUrl = 'leotelebot_saved_vps_url';
  static const String _prefKeyBatteryPrompt = 'has_prompted_battery_v1';
  static const MethodChannel _batteryChannel = MethodChannel('com.leotelebot.app/battery');

  late final WebViewController _webViewController;
  String _currentVpsUrl = _defaultVpsUrl;
  bool _isLoading = true;
  int _loadingProgress = 0;
  bool _hasError = false;
  String _errorDescription = '';
  bool _canGoBack = false;
  bool _hasLoadedInitialPage = false;

  @override
  void initState() {
    super.initState();
    _initializeWebView();
    _loadSavedVpsUrl();
    _checkFirstLaunchBatteryPermission();
  }

  // 🚀 First Time Launch Dialog (in Clean Professional English)
  Future<void> _checkFirstLaunchBatteryPermission() async {
    await Future.delayed(const Duration(milliseconds: 1400));
    if (!mounted) return;

    try {
      final prefs = await SharedPreferences.getInstance();
      final hasPrompted = prefs.getBool(_prefKeyBatteryPrompt) ?? false;
      if (!hasPrompted) {
        _showFirstLaunchBatteryDialog();
      }
    } catch (_) {}
  }

  Future<void> _requestBatteryOptimizationPermission() async {
    try {
      await _batteryChannel.invokeMethod('requestIgnoreBatteryOptimizations');
    } catch (_) {}
  }

  void _showFirstLaunchBatteryDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF162338),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Row(
          children: const [
            Icon(Icons.bolt_rounded, color: Color(0xFF00E5FF), size: 26),
            SizedBox(width: 8),
            Text('Enable 24/7 Run Mode ⚡', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Allow LeoTeleBot to run uninterrupted in the background so your Telegram automation stays active 24/7, even when your phone is locked.',
              style: TextStyle(fontSize: 12.5, color: Colors.white70, height: 1.4),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFF0C131D),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.3)),
              ),
              child: Row(
                children: const [
                  Icon(Icons.check_circle_rounded, color: Color(0xFF00E5FF), size: 18),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Tap "ALLOW" on the upcoming system prompt.',
                      style: TextStyle(fontSize: 11.5, color: Color(0xFF00E5FF), fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final prefs = await SharedPreferences.getInstance();
              await prefs.setBool(_prefKeyBatteryPrompt, true);
            },
            child: const Text('Later', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF00B0FF),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () async {
              Navigator.pop(ctx);
              final prefs = await SharedPreferences.getInstance();
              await prefs.setBool(_prefKeyBatteryPrompt, true);
              _requestBatteryOptimizationPermission();
            },
            icon: const Icon(Icons.flash_on_rounded, size: 16),
            label: const Text('ALLOW 24/7 RUN ⚡', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12.5)),
          ),
        ],
      ),
    );
  }

  void _initializeWebView() {
    _webViewController = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setUserAgent('LeoTeleBot-Native-Android/2.1 (Linux; Android; Mobile; Engine: NativeApp)')
      ..enableZoom(false)
      ..setBackgroundColor(const Color(0xFF0C131D))
      ..addJavaScriptChannel(
        'LeoNativeBridge',
        onMessageReceived: (JavaScriptMessage message) {
          try {
            final data = jsonDecode(message.message);
            if (data is Map && data['action'] == 'open_url') {
              final targetUrl = data['url']?.toString();
              if (targetUrl != null && targetUrl.isNotEmpty) {
                _launchExternalUrl(targetUrl);
              }
            }
          } catch (_) {}
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (int progress) {
            if (mounted) {
              setState(() {
                _loadingProgress = progress;
                if (progress >= 100) {
                  _isLoading = false;
                }
              });
            }
          },
          onNavigationRequest: (NavigationRequest request) {
            final url = request.url;
            // ✈️ Telegram deep links or external intent protocols: open in external Telegram app
            if (url.startsWith('tg:') ||
                url.startsWith('intent:') ||
                url.contains('t.me/') ||
                url.contains('telegram.me/')) {
              _launchExternalUrl(url);
              return NavigationDecision.prevent;
            }

            // Normal in-app VPS navigation
            final currentUri = Uri.tryParse(_currentVpsUrl);
            final reqUri = Uri.tryParse(url);
            if (reqUri != null && currentUri != null) {
              if (reqUri.host == currentUri.host || reqUri.host.isEmpty) {
                return NavigationDecision.navigate;
              }
            }

            // Any other external web link: open safely outside webview without breaking VPS session
            if (url.startsWith('http://') || url.startsWith('https://')) {
              _launchExternalUrl(url);
              return NavigationDecision.prevent;
            }

            return NavigationDecision.prevent;
          },
          onPageStarted: (String url) async {
            if (mounted) {
              setState(() {
                _isLoading = true;
                _hasError = false;
              });
            }
            try {
              await _webViewController.runJavaScript('''
                window.isNativeApp = true;
                window.nativeAppPlatform = 'android';
                window.leoTeleBotVersion = '2.1.0';
              ''');
            } catch (_) {}
          },
          onPageFinished: (String url) async {
            // Clean view styling that preserves natural DOM hierarchy & centered modals & smooth scrolling
            try {
              await _webViewController.runJavaScript('''
                (function() {
                  window.isNativeApp = true;
                  window.nativeAppPlatform = 'android';
                  window.leoTeleBotVersion = '2.1.0';
                  
                  const style = document.createElement('style');
                  style.innerHTML = `
                    * {
                      -webkit-tap-highlight-color: transparent !important;
                    }
                    html {
                      scroll-behavior: smooth !important;
                      -webkit-overflow-scrolling: touch !important;
                      height: auto !important;
                      min-height: 100% !important;
                    }
                    body {
                      -webkit-overflow-scrolling: touch !important;
                      height: auto !important;
                      min-height: 100% !important;
                      overflow-y: auto !important;
                      overflow-x: hidden !important;
                    }
                    /* Ensure confirmation modals always center over viewport */
                    .confirm-overlay, #confirmPopupModal {
                      position: fixed !important;
                      top: 0 !important;
                      left: 0 !important;
                      right: 0 !important;
                      bottom: 0 !important;
                      width: 100vw !important;
                      height: 100vh !important;
                      display: none;
                      align-items: center !important;
                      justify-content: center !important;
                      z-index: 999999 !important;
                    }
                  `;
                  document.head.appendChild(style);
                })();
              ''');
            } catch (_) {}

            final canBack = await _webViewController.canGoBack();
            if (mounted) {
              setState(() {
                _isLoading = false;
                _canGoBack = canBack;
                _hasLoadedInitialPage = true;
                _hasError = false;
              });
            }
          },
          onWebResourceError: (WebResourceError error) {
            // 🛡️ CRITICAL: If the user is already on the VPS dashboard, NEVER kick them out to the error screen!
            if (_hasLoadedInitialPage) {
              return;
            }

            final desc = error.description.toLowerCase();
            final failedUrl = error.url?.toLowerCase() ?? '';

            // Ignore external schemes, Telegram links, intents, or aborted navigations
            if (desc.contains('err_unknown_url_scheme') ||
                desc.contains('err_aborted') ||
                desc.contains('net::err_unknown_url_scheme') ||
                desc.contains('tg:') ||
                desc.contains('t.me') ||
                desc.contains('intent:') ||
                failedUrl.contains('t.me') ||
                failedUrl.contains('tg:') ||
                failedUrl.contains('intent:')) {
              return;
            }

            // Only on the very first initial connection attempt: if the VPS host fails to load
            if (error.isForMainFrame == true && !_hasLoadedInitialPage) {
              if (mounted) {
                setState(() {
                  _hasError = true;
                  _errorDescription = error.description;
                  _isLoading = false;
                });
              }
            }
          },
        ),
      );
  }

  Future<void> _launchExternalUrl(String url) async {
    try {
      await _batteryChannel.invokeMethod('openUrl', {'url': url});
    } catch (_) {}
  }

  Future<void> _loadSavedVpsUrl() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedUrl = prefs.getString(_prefKeyVpsUrl);
      if (savedUrl != null && savedUrl.trim().isNotEmpty) {
        _currentVpsUrl = savedUrl.trim();
      }
    } catch (_) {}

    _loadVpsInBrowser(_currentVpsUrl);
  }

  void _loadVpsInBrowser(String rawUrl) {
    var url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    _currentVpsUrl = url;
    _hasLoadedInitialPage = false;
    setState(() {
      _isLoading = true;
      _hasError = false;
      _errorDescription = '';
    });

    _webViewController.loadRequest(Uri.parse(url));
  }

  // 🔋 24/7 Run Guide Dialog in Clean English
  void _showBatteryGuideDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF162338),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.battery_charging_full_rounded, color: Color(0xFF00E5FF), size: 24),
            SizedBox(width: 8),
            Text('24/7 Background Setup ⚡', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Keep your automated Telegram bot running continuously 24/7, even when your phone is locked or screen is off.',
                style: TextStyle(fontSize: 12, color: Colors.white70, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              _buildGuideStep('1. Battery Optimization Exemption', 'Tap the button below to grant unrestricted background battery permission.'),
              _buildGuideStep('2. Allow Background Data', 'Ensure background mobile data and Wi-Fi access remain enabled.'),
              _buildGuideStep('3. Lock in Recent Apps', 'In your phone\'s Recent Apps switcher, lock LeoTeleBot 🔒 to prevent background closing.'),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFF0C131D),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.3)),
                ),
                child: const Text(
                  '💡 The bot runs in direct sync with your cloud VPS engine, delivering 100% of messages even with your screen turned off.',
                  style: TextStyle(fontSize: 11, color: Color(0xFF00E5FF)),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Close', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF00B0FF),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              _requestBatteryOptimizationPermission();
            },
            icon: const Icon(Icons.flash_on_rounded, size: 16),
            label: const Text('ALLOW 24/7 RUN ⚡', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  static Widget _buildGuideStep(String title, String desc) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: Color(0xFF38BDF8))),
          const SizedBox(height: 2),
          Text(desc, style: const TextStyle(fontSize: 11.5, color: Colors.white60)),
        ],
      ),
    );
  }

  Future<void> _changeVpsDialog() async {
    final textController = TextEditingController(text: _currentVpsUrl);
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF162338),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.cloud_sync_rounded, color: Color(0xFF00B0FF), size: 24),
            SizedBox(width: 8),
            Text('Connect VPS Server', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enter your VPS IP address or Domain (e.g. https://bot10.xyz or http://159.65.1.2:3000):',
              style: TextStyle(fontSize: 12, color: Colors.white70),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: textController,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: InputDecoration(
                filled: true,
                fillColor: const Color(0xFF0C131D),
                hintText: 'https://bot10.xyz',
                hintStyle: const TextStyle(color: Colors.white30, fontSize: 12),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(color: Color(0xFF00B0FF), width: 1),
                ),
              ),
              style: const TextStyle(fontSize: 13, color: Colors.white),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF00B0FF),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () async {
              final newUrl = textController.text.trim();
              if (newUrl.isNotEmpty) {
                Navigator.pop(ctx);
                try {
                  final prefs = await SharedPreferences.getInstance();
                  await prefs.setString(_prefKeyVpsUrl, newUrl);
                } catch (_) {}
                _loadVpsInBrowser(newUrl);
              }
            },
            child: const Text('SAVE & CONNECT', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_canGoBack,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (await _webViewController.canGoBack()) {
          await _webViewController.goBack();
          final canBack = await _webViewController.canGoBack();
          setState(() => _canGoBack = canBack);
        }
      },
      child: Scaffold(
        resizeToAvoidBottomInset: true,
        appBar: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFF081224), Color(0xFF0D254C), Color(0xFF0A1832)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              border: Border(bottom: BorderSide(color: Color(0x3300B0FF), width: 1)),
            ),
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    // Left Side: Embedded Cyber Robot Logo + LeoTeleBot Title + Live Status
                    Flexible(
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // 🤖 Actual Robot App Logo (Always loads instantly from memory)
                          ClipRRect(
                            borderRadius: BorderRadius.circular(7),
                            child: Container(
                              width: 30,
                              height: 30,
                              decoration: BoxDecoration(
                                color: const Color(0xFF0C131D),
                                border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.5), width: 1),
                              ),
                              child: Image.memory(
                                kLeoTeleBotLogoBytes,
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                          const SizedBox(width: 7),

                          // App Title: LeoTeleBot
                          const Text.rich(
                            TextSpan(
                              children: [
                                TextSpan(
                                  text: 'Leo',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w900,
                                    fontSize: 14.5,
                                    color: Colors.white,
                                  ),
                                ),
                                TextSpan(
                                  text: 'TeleBot',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w900,
                                    fontSize: 14.5,
                                    color: Color(0xFF00B0FF),
                                  ),
                                ),
                              ],
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(width: 6),

                          // Live Status Pill
                          InkWell(
                            onTap: _changeVpsDialog,
                            borderRadius: BorderRadius.circular(10),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                              decoration: BoxDecoration(
                                color: _hasError ? Colors.red.withOpacity(0.2) : const Color(0xFF00E5FF).withOpacity(0.15),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                  color: _hasError ? Colors.redAccent : const Color(0xFF00E5FF),
                                  width: 0.8,
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    width: 5,
                                    height: 5,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: _hasError ? Colors.redAccent : const Color(0xFF00E5FF),
                                    ),
                                  ),
                                  const SizedBox(width: 3),
                                  Text(
                                    _hasError ? 'OFF' : 'LIVE',
                                    style: TextStyle(
                                      fontSize: 8.5,
                                      fontWeight: FontWeight.w800,
                                      color: _hasError ? Colors.redAccent : const Color(0xFF00E5FF),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // Right Side Action Buttons
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.battery_charging_full_rounded, color: Color(0xFF00E5FF), size: 19),
                          tooltip: '24/7 Battery Setup',
                          padding: const EdgeInsets.all(4),
                          constraints: const BoxConstraints(),
                          onPressed: _showBatteryGuideDialog,
                        ),
                        const SizedBox(width: 6),
                        IconButton(
                          icon: const Icon(Icons.refresh_rounded, color: Colors.white, size: 19),
                          tooltip: 'Reload Dashboard',
                          padding: const EdgeInsets.all(4),
                          constraints: const BoxConstraints(),
                          onPressed: () {
                            setState(() => _isLoading = true);
                            _webViewController.reload();
                          },
                        ),
                        const SizedBox(width: 6),
                        IconButton(
                          icon: const Icon(Icons.settings_outlined, color: Color(0xFF00B0FF), size: 19),
                          tooltip: 'Change VPS Server',
                          padding: const EdgeInsets.all(4),
                          constraints: const BoxConstraints(),
                          onPressed: _changeVpsDialog,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        // 🚀 Pure native WebView without gesture-stealing RefreshIndicator for 120Hz smooth scrolling
        body: Stack(
          children: [
            if (!_hasError)
              WebViewWidget(
                controller: _webViewController,
                gestureRecognizers: {
                  Factory<OneSequenceGestureRecognizer>(() => EagerGestureRecognizer()),
                },
              ),
            if (_isLoading && _loadingProgress < 100)
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: LinearProgressIndicator(
                  value: _loadingProgress / 100.0,
                  backgroundColor: Colors.transparent,
                  valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF00B0FF)),
                  minHeight: 2.5,
                ),
              ),
            if (_hasError)
              Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 28),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          color: Colors.red.withOpacity(0.12),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.wifi_off_rounded, color: Colors.redAccent, size: 32),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Could Not Connect to VPS',
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Colors.white),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Target: $_currentVpsUrl\n$_errorDescription',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 11.5, color: Colors.white60),
                      ),
                      const SizedBox(height: 20),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          OutlinedButton.icon(
                            onPressed: _changeVpsDialog,
                            icon: const Icon(Icons.edit_rounded, size: 16),
                            label: const Text('Change VPS URL', style: TextStyle(fontSize: 12)),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: const Color(0xFF00B0FF),
                              side: const BorderSide(color: Color(0xFF00B0FF)),
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            ),
                          ),
                          const SizedBox(width: 12),
                          ElevatedButton.icon(
                            onPressed: () => _loadVpsInBrowser(_currentVpsUrl),
                            icon: const Icon(Icons.replay_rounded, size: 16),
                            label: const Text('Try Again', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF00B0FF),
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
