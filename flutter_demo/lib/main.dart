import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// CrypterChat Flutter demo — peer-to-peer chat with ChatScan under the hood.
///
/// Chat UI matches the main CrypterChat app style: users see normal readable
/// messages. Ciphertext hashes / refs appear only on the ChatScan explorer.
const String kMessagingBaseUrlFromEnv = String.fromEnvironment('MESSAGING_URL');
const String kDemoOtp = '123456';

// Colors aligned with lib/Configs/app_constants.dart (main CrypterChat app).
const Color kPrimary = Color(0xFF6842ED);
const Color kSecondary = Color(0xFF5B36D0);
const Color kChatBackground = Color(0xFFE8DED5);
const Color kBubbleMine = Color(0xFFE9FEDF);
const Color kBubblePeer = Color(0xFFFFFFFF);
const Color kAppBar = Color(0xFFFFFFFF);
const Color kInk = Color(0xFF1E1E1E);
const Color kMuted = Color(0xFF8596A0);

/// Android emulator reaches the host via 10.0.2.2; web/desktop use loopback.
String defaultMessagingBaseUrl() {
  if (kMessagingBaseUrlFromEnv.isNotEmpty) return kMessagingBaseUrlFromEnv;
  if (kIsWeb) return 'http://127.0.0.1:8787';
  return 'http://10.0.2.2:8787';
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Expose DOM semantics on web so automated demos / assistive tech can drive
  // the UI (inputs + buttons) without a manual a11y tap.
  if (kIsWeb) {
    SemanticsBinding.instance.ensureSemantics();
  }
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: kAppBar,
    statusBarIconBrightness: Brightness.dark,
  ));
  runApp(const CrypterChatDemoApp());
}

class CrypterChatDemoApp extends StatelessWidget {
  const CrypterChatDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CrypterChat',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: false,
        primaryColor: kPrimary,
        colorScheme: ColorScheme.fromSwatch().copyWith(
          primary: kPrimary,
          secondary: kSecondary,
        ),
        scaffoldBackgroundColor: const Color(0xFFF4F5F6),
        appBarTheme: const AppBarTheme(
          backgroundColor: kAppBar,
          foregroundColor: kInk,
          elevation: 0.5,
          centerTitle: false,
        ),
        floatingActionButtonTheme: const FloatingActionButtonThemeData(
          backgroundColor: kPrimary,
          foregroundColor: Colors.white,
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: kPrimary,
            foregroundColor: Colors.white,
          ),
        ),
      ),
      home: const GateScreen(),
    );
  }
}

class ApiClient {
  ApiClient({required this.baseUrl});

  final String baseUrl;
  String? token;
  Map<String, dynamic>? user;

  Uri _u(String path, [Map<String, String>? q]) =>
      Uri.parse('$baseUrl$path').replace(queryParameters: q);

  Future<Map<String, dynamic>> _json(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
    bool auth = true,
  }) async {
    final headers = <String, String>{'accept': 'application/json'};
    if (body != null) headers['content-type'] = 'application/json';
    if (auth && token != null) headers['authorization'] = 'Bearer $token';
    final req = http.Request(method, _u(path, query));
    req.headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);
    final streamed = await req.send().timeout(const Duration(seconds: 20));
    final res = await http.Response.fromStream(streamed);
    final data = res.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception(data['error'] ?? 'HTTP ${res.statusCode}');
    }
    return data;
  }

  Future<Map<String, dynamic>> health() => _json('GET', '/api/health', auth: false);

  Future<void> requestOtp(String phone, String displayName) async {
    await _json('POST', '/api/auth/request-otp', auth: false, body: {
      'phone': phone,
      'displayName': displayName,
    });
  }

  Future<void> verifyOtp(String phone, String displayName, String code) async {
    final data = await _json('POST', '/api/auth/verify-otp', auth: false, body: {
      'phone': phone,
      'displayName': displayName,
      'code': code,
    });
    token = data['token'] as String?;
    user = (data['user'] as Map?)?.cast<String, dynamic>();
  }

  Future<List<Map<String, dynamic>>> conversations() async {
    final data = await _json('GET', '/api/conversations');
    return ((data['conversations'] as List?) ?? [])
        .map((e) => (e as Map).cast<String, dynamic>())
        .toList();
  }

  Future<Map<String, dynamic>> send(String to, String text) =>
      _json('POST', '/api/messages/send', body: {'to': to, 'text': text});

  Future<List<Map<String, dynamic>>> messages(String conversationId) async {
    final data = await _json('GET', '/api/messages', query: {
      'conversationId': conversationId,
    });
    return ((data['messages'] as List?) ?? [])
        .map((e) => (e as Map).cast<String, dynamic>())
        .toList();
  }

  Future<Map<String, dynamic>> chainStatus() => _json('GET', '/api/chain/status');

  Future<Map<String, dynamic>> serverInfo() => _json('GET', '/api/server', auth: false);
}

/// Persists the user's chosen chat-server base URL (their own server).
class ServerStore {
  static const _baseKey = 'cc_server_base';

  static Future<String> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_baseKey);
    if (saved != null && saved.trim().isNotEmpty) return saved.trim();
    return defaultMessagingBaseUrl();
  }

  static Future<void> save(String baseUrl) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_baseKey, baseUrl.trim().replaceAll(RegExp(r'/+$'), ''));
  }
}

class SessionStore {
  static const _tokenKey = 'cc_token';
  static const _userKey = 'cc_user';

  static Future<void> save(ApiClient api) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, api.token ?? '');
    await prefs.setString(_userKey, jsonEncode(api.user ?? {}));
    await ServerStore.save(api.baseUrl);
  }

  static Future<ApiClient?> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_tokenKey);
    final userRaw = prefs.getString(_userKey);
    final base = await ServerStore.load();
    if (token == null || token.isEmpty || userRaw == null || userRaw.isEmpty) {
      return null;
    }
    final api = ApiClient(baseUrl: base)..token = token;
    api.user = jsonDecode(userRaw) as Map<String, dynamic>;
    try {
      await api._json('GET', '/api/me');
      return api;
    } catch (_) {
      return null;
    }
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_userKey);
    // Keep ServerStore URL so the user stays on their own server after sign-out.
  }
}

class GateScreen extends StatefulWidget {
  const GateScreen({super.key});

  @override
  State<GateScreen> createState() => _GateScreenState();
}

class _GateScreenState extends State<GateScreen> {
  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    final api = await SessionStore.restore();
    if (!mounted) return;
    if (api != null) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => HomeScreen(api: api)),
      );
    } else {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.lock_rounded, color: kPrimary, size: 64),
            SizedBox(height: 16),
            Text(
              'CrypterChat',
              style: TextStyle(
                color: kInk,
                fontSize: 32,
                fontWeight: FontWeight.w700,
              ),
            ),
            SizedBox(height: 8),
            Text('Connecting…', style: TextStyle(color: kMuted)),
          ],
        ),
      ),
    );
  }
}

/// Choose / switch the chat server URL. Chat data stays on that server;
/// ChatScan remains the shared hash chain.
class ServerSettingsScreen extends StatefulWidget {
  const ServerSettingsScreen({super.key, this.currentUrl});

  final String? currentUrl;

  @override
  State<ServerSettingsScreen> createState() => _ServerSettingsScreenState();
}

class _ServerSettingsScreenState extends State<ServerSettingsScreen> {
  late final TextEditingController _url;
  bool _busy = false;
  String? _info;
  String? _error;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: widget.currentUrl ?? '');
    if (_url.text.isEmpty) {
      ServerStore.load().then((v) {
        _url.text = v;
        _test();
      });
    } else {
      _test();
    }
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _test() async {
    final base = _url.text.trim().replaceAll(RegExp(r'/+$'), '');
    if (base.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = ApiClient(baseUrl: base);
      final info = await api.serverInfo();
      final cs = info['chatscan'] as Map<String, dynamic>?;
      setState(() {
        _info =
            '${info['name'] ?? 'Chat server'}\n'
            'Chat data stored on this server\n'
            'ChatScan ${cs?['chainId']} · height ${cs?['height']} (shared hashes)';
        _error = null;
      });
    } catch (e) {
      setState(() {
        _info = null;
        _error = 'Cannot reach server: $e';
      });
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    final base = _url.text.trim().replaceAll(RegExp(r'/+$'), '');
    if (base.isEmpty) {
      setState(() => _error = 'Enter a server URL');
      return;
    }
    await _test();
    if (_error != null) return;
    await ServerStore.save(base);
    if (!mounted) return;
    final switched = widget.currentUrl != null && widget.currentUrl != base;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(switched
            ? 'Server saved. Sign in again on the new server.'
            : 'Server saved.'),
      ),
    );
    Navigator.of(context).pop(switched);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Chat server')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Run your own CrypterChat server and paste its URL here. '
            'Your chats (encrypted) stay on that server. Message hashes still seal on ChatScan.',
            style: TextStyle(height: 1.4, color: kMuted),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF4F5F6),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Text(
              'On the machine that will host chat data:\n'
              '  ./scripts/start-own-server.sh\n\n'
              'Then paste the printed Base URL below (LAN IP works for phones on the same Wi‑Fi).',
              style: TextStyle(height: 1.4, fontSize: 13, color: kInk),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _url,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              labelText: 'Chat server URL',
              hintText: 'http://192.168.1.20:8787',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.dns_outlined),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              TextButton.icon(
                onPressed: _busy ? null : _test,
                icon: const Icon(Icons.wifi_tethering),
                label: const Text('Test'),
              ),
              const SizedBox(width: 8),
              TextButton(
                onPressed: () {
                  _url.text = defaultMessagingBaseUrl();
                  _test();
                },
                child: const Text('Use default'),
              ),
            ],
          ),
          if (_info != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFF0EBFF),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(_info!, style: const TextStyle(color: kSecondary, height: 1.35)),
            ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 24),
          SizedBox(
            height: 48,
            child: ElevatedButton(
              onPressed: _busy ? null : _save,
              child: const Text('Save server'),
            ),
          ),
        ],
      ),
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _otp = TextEditingController(text: kDemoOtp);
  final _base = TextEditingController();
  bool _otpSent = false;
  bool _busy = false;
  String? _serverHint;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadServer();
  }

  Future<void> _loadServer() async {
    final saved = await ServerStore.load();
    _base.text = saved;
    await _probe();
  }

  Future<void> _probe() async {
    final url = _base.text.trim();
    if (url.isEmpty) return;
    try {
      final api = ApiClient(baseUrl: url);
      final health = await api.health();
      final server = health['server'] as Map<String, dynamic>?;
      final cs = health['chatscan'] as Map<String, dynamic>?;
      setState(() {
        _serverHint =
            '${server?['name'] ?? 'Chat server'} · chat data on this server\n'
            'ChatScan ${cs?['chainId']} · height ${cs?['height']} (hashes only)';
        _error = null;
      });
      await ServerStore.save(url);
    } catch (e) {
      setState(() {
        _serverHint = null;
        _error = 'Server unreachable: $e';
      });
    }
  }

  Future<void> _requestOtp() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ServerStore.save(_base.text.trim());
      final api = ApiClient(baseUrl: _base.text.trim());
      await api.requestOtp(_phone.text.trim(), _name.text.trim());
      setState(() => _otpSent = true);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = ApiClient(baseUrl: _base.text.trim());
      await api.verifyOtp(
        _phone.text.trim(),
        _name.text.trim(),
        _otp.text.trim().isEmpty ? kDemoOtp : _otp.text.trim(),
      );
      await SessionStore.save(api);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => HomeScreen(api: api)),
      );
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Verify your phone number')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Use your phone number like a normal messaging app. '
            'Chat data lives on the chat server you choose; only message hashes go to ChatScan.',
            style: TextStyle(height: 1.4, color: kMuted),
          ),
          const SizedBox(height: 20),
          const Text('Your chat server',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 6),
          const Text(
            'Paste the base URL of a server you host (or a friend’s). '
            'Run ./scripts/start-own-server.sh to start one.',
            style: TextStyle(height: 1.35, color: kMuted, fontSize: 13),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _base,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              labelText: 'Chat server URL',
              hintText: 'http://192.168.1.20:8787',
              helperText: 'Emulator → host: http://10.0.2.2:8787',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.dns_outlined),
            ),
            onChanged: (_) {
              _otpSent = false;
              _probe();
            },
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: _busy ? null : _probe,
              icon: const Icon(Icons.wifi_tethering),
              label: const Text('Test connection'),
            ),
          ),
          if (_serverHint != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFF0EBFF),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(_serverHint!,
                  style: const TextStyle(color: kSecondary, height: 1.35)),
            ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 20),
          const Text('Your phone',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 10),
          TextField(
            controller: _name,
            decoration: const InputDecoration(
              labelText: 'Display name',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: 'Phone number (E.164)',
              hintText: '+15551110001',
              border: OutlineInputBorder(),
            ),
          ),
          if (_otpSent) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _otp,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'OTP code',
                helperText: 'Demo OTP is 123456',
                border: OutlineInputBorder(),
              ),
            ),
          ],
          const SizedBox(height: 20),
          SizedBox(
            height: 48,
            child: ElevatedButton(
              onPressed: _busy
                  ? null
                  : () => _otpSent ? _verify() : _requestOtp(),
              child: Text(_otpSent ? 'NEXT' : 'SEND CODE'),
            ),
          ),
        ],
      ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Map<String, dynamic>> _conversations = [];
  String? _serverLabel;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final list = await widget.api.conversations();
      final health = await widget.api.health();
      final server = health['server'] as Map<String, dynamic>?;
      final cs = health['chatscan'] as Map<String, dynamic>?;
      if (!mounted) return;
      setState(() {
        _conversations = list;
        _serverLabel =
            '${server?['name'] ?? 'Chat server'} · ${widget.api.baseUrl}\n'
            'ChatScan ${cs?['chainId']} · h${cs?['height']} (hashes only)';
      });
    } catch (_) {
      /* keep last good state */
    }
  }

  Future<void> _openServerSettings() async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ServerSettingsScreen(currentUrl: widget.api.baseUrl),
      ),
    );
    if (changed == true && mounted) {
      await SessionStore.clear();
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (_) => false,
      );
    }
  }

  Future<void> _newChat() async {
    final controller = TextEditingController(text: '+15551110002');
    final phone = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New chat'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(
            labelText: 'Phone number',
            hintText: '+15551110002',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Open'),
          ),
        ],
      ),
    );
    if (phone == null || phone.isEmpty || !mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChatScreen(api: widget.api, peerPhone: phone),
      ),
    );
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.api.user;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('CrypterChat', style: TextStyle(fontWeight: FontWeight.w700)),
            Text(
              '${me?['displayName'] ?? ''} · ${me?['phone'] ?? ''}',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w400),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Server settings',
            onPressed: _openServerSettings,
            icon: const Icon(Icons.dns_outlined),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: () async {
              await SessionStore.clear();
              if (!context.mounted) return;
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              );
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_serverLabel != null)
            Container(
              width: double.infinity,
              color: const Color(0xFFF0EBFF),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                _serverLabel!,
                style: const TextStyle(color: kSecondary, fontSize: 12, height: 1.35),
              ),
            ),
          Expanded(
            child: _conversations.isEmpty
                ? const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'No chats yet.\nTap the message button to start a conversation by phone number.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Color(0xFF667781), height: 1.4),
                      ),
                    ),
                  )
                : ListView.separated(
                    itemCount: _conversations.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final c = _conversations[index];
                      final peerName =
                          c['peerName']?.toString() ?? c['peer']?.toString() ?? 'chat';
                      final peerPhone = c['peer'] as String;
                      return Semantics(
                        button: true,
                        label: 'Open chat with $peerName $peerPhone',
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: const Color(0xFFEDE7FF),
                            child: Text(
                              peerName.isEmpty ? '?' : peerName[0].toUpperCase(),
                              style: const TextStyle(color: kPrimary),
                            ),
                          ),
                          title: Text(
                            peerName,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(
                            c['lastPreview']?.toString() ?? 'No messages yet',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: kMuted),
                          ),
                          onTap: () async {
                            await Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => ChatScreen(
                                  api: widget.api,
                                  peerPhone: peerPhone,
                                  conversationId: c['id'] as String?,
                                ),
                              ),
                            );
                            _refresh();
                          },
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
      floatingActionButton: Semantics(
        button: true,
        label: 'New chat',
        child: FloatingActionButton(
          onPressed: _newChat,
          child: const Icon(Icons.message),
        ),
      ),
    );
  }
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.api,
    required this.peerPhone,
    this.conversationId,
  });

  final ApiClient api;
  final String peerPhone;
  final String? conversationId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  List<Map<String, dynamic>> _messages = [];
  late String _conversationId;
  bool _sending = false;
  Timer? _timer;
  String? _toast;

  @override
  void initState() {
    super.initState();
    final me = widget.api.user?['phone'] as String? ?? '';
    _conversationId = widget.conversationId ??
        ([me, widget.peerPhone]..sort()).join(':');
    _load();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final msgs = await widget.api.messages(_conversationId);
      if (!mounted) return;
      final atBottom = !_scroll.hasClients ||
          _scroll.position.pixels >= _scroll.position.maxScrollExtent - 40;
      setState(() => _messages = msgs);
      if (atBottom) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_scroll.hasClients) {
            _scroll.jumpTo(_scroll.position.maxScrollExtent);
          }
        });
      }
    } catch (_) {}
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final result = await widget.api.send(widget.peerPhone, text);
      final message = result['message'] as Map<String, dynamic>?;
      _input.clear();
      if (message?['conversationId'] != null) {
        _conversationId = message!['conversationId'] as String;
      }
      // Peer chat stays a normal messaging UI — no hash toast.
      setState(() => _toast = null);
      await _load();
    } catch (e) {
      setState(() => _toast = 'Send failed: $e');
      Future.delayed(const Duration(seconds: 3), () {
        if (mounted) setState(() => _toast = null);
      });
    } finally {
      setState(() => _sending = false);
    }
  }

  String _formatTime(dynamic createdAt) {
    if (createdAt == null) return '';
    final dt = DateTime.fromMillisecondsSinceEpoch(
      createdAt is int ? createdAt : int.tryParse('$createdAt') ?? 0,
      isUtc: false,
    );
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  void _showChainDetails(Map<String, dynamic> message) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Sealed on ChatScan',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              const Text(
                'Your chat shows the normal message. ChatScan’s public chain only stores the ciphertext hash — never the text.',
                style: TextStyle(color: kMuted, height: 1.35),
              ),
              const SizedBox(height: 14),
              SelectableText('ref ${message['ref'] ?? ''}',
                  style: const TextStyle(fontSize: 12, fontFamily: 'monospace')),
              const SizedBox(height: 6),
              SelectableText('hash ${message['ciphertextHash'] ?? ''}',
                  style: const TextStyle(fontSize: 12, fontFamily: 'monospace')),
              const SizedBox(height: 6),
              Text(
                'status ${message['status'] ?? ''} · content not public',
                style: const TextStyle(fontSize: 12, color: kMuted),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Done'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.api.user?['phone'];
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            const CircleAvatar(
              radius: 18,
              backgroundColor: Color(0xFFEDE7FF),
              child: Icon(Icons.person, color: kPrimary, size: 20),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.peerPhone,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  const Text('End-to-end encrypted',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w400, color: kMuted)),
                ],
              ),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: Container(
              color: kChatBackground,
              child: ListView.builder(
                controller: _scroll,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                itemCount: _messages.length,
                itemBuilder: (context, index) {
                  final m = _messages[index];
                  final mine = m['from'] == me;
                  final text = m['plaintext']?.toString() ?? '';
                  return Align(
                    alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                    child: GestureDetector(
                      onLongPress: () => _showChainDetails(m),
                      child: Container(
                        constraints: BoxConstraints(
                          maxWidth: MediaQuery.of(context).size.width * 0.78,
                        ),
                        margin: const EdgeInsets.symmetric(vertical: 3),
                        padding: const EdgeInsets.fromLTRB(12, 8, 10, 6),
                        decoration: BoxDecoration(
                          // Main CrypterChat bubble colors: soft green mine, white peer.
                          color: mine ? kBubbleMine : kBubblePeer,
                          borderRadius: BorderRadius.only(
                            topLeft: const Radius.circular(12),
                            topRight: const Radius.circular(12),
                            bottomLeft: Radius.circular(mine ? 12 : 3),
                            bottomRight: Radius.circular(mine ? 3 : 12),
                          ),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x14000000),
                              blurRadius: 2,
                              offset: Offset(0, 1),
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Align(
                              alignment: Alignment.centerLeft,
                              child: Text(
                                text.isEmpty ? '…' : text,
                                style: const TextStyle(
                                  fontSize: 16,
                                  height: 1.3,
                                  color: kInk,
                                ),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  _formatTime(m['createdAt']),
                                  style: const TextStyle(fontSize: 11, color: kMuted),
                                ),
                                const SizedBox(width: 4),
                                // Subtle sealed tick — details on long-press; hashes stay on ChatScan.
                                Icon(
                                  Icons.done_all,
                                  size: 14,
                                  color: mine ? kPrimary.withOpacity(0.7) : kMuted,
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          if (_toast != null)
            Container(
              width: double.infinity,
              color: kPrimary,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text(_toast!,
                  style: const TextStyle(color: Colors.white, fontSize: 12)),
            ),
          SafeArea(
            top: false,
            child: Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFFF4F5F6),
                        borderRadius: BorderRadius.circular(24),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      child: TextField(
                        controller: _input,
                        minLines: 1,
                        maxLines: 5,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _send(),
                        decoration: const InputDecoration(
                          hintText: 'Type a message',
                          border: InputBorder.none,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Semantics(
                    button: true,
                    label: 'Send',
                    child: CircleAvatar(
                      backgroundColor: kPrimary,
                      child: IconButton(
                        onPressed: _sending ? null : _send,
                        icon: Icon(
                          _sending ? Icons.hourglass_top : Icons.send,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
