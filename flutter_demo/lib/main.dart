import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// WhatsApp-style CrypterChat demo wired to the ChatScan X11 messaging bridge.
///
/// Phone login + chat UI mirror the main app experience. Every send goes through
/// ChatScan — only ciphertext hashes are public on the explorer.
const String kMessagingBaseUrlFromEnv = String.fromEnvironment('MESSAGING_URL');
const String kDemoOtp = '123456';

/// Android emulator reaches the host via 10.0.2.2; web/desktop use loopback.
String defaultMessagingBaseUrl() {
  if (kMessagingBaseUrlFromEnv.isNotEmpty) return kMessagingBaseUrlFromEnv;
  if (kIsWeb) return 'http://127.0.0.1:8787';
  return 'http://10.0.2.2:8787';
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Expose DOM semantics on web so automated demos / assistive tech can drive
  // the WhatsApp-style UI (inputs + buttons) without a manual a11y tap.
  if (kIsWeb) {
    SemanticsBinding.instance.ensureSemantics();
  }
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Color(0xFF075E54),
    statusBarIconBrightness: Brightness.light,
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
        primaryColor: const Color(0xFF075E54),
        colorScheme: ColorScheme.fromSwatch().copyWith(
          primary: const Color(0xFF075E54),
          secondary: const Color(0xFF25D366),
        ),
        scaffoldBackgroundColor: const Color(0xFFECE5DD),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF075E54),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
        floatingActionButtonTheme: const FloatingActionButtonThemeData(
          backgroundColor: Color(0xFF25D366),
          foregroundColor: Colors.white,
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
}

class SessionStore {
  static const _tokenKey = 'cc_token';
  static const _userKey = 'cc_user';
  static const _baseKey = 'cc_base';

  static Future<void> save(ApiClient api) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, api.token ?? '');
    await prefs.setString(_userKey, jsonEncode(api.user ?? {}));
    await prefs.setString(_baseKey, api.baseUrl);
  }

  static Future<ApiClient?> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_tokenKey);
    final userRaw = prefs.getString(_userKey);
    final base = prefs.getString(_baseKey) ?? defaultMessagingBaseUrl();
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
      backgroundColor: Color(0xFF075E54),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.lock_rounded, color: Colors.white, size: 64),
            SizedBox(height: 16),
            Text(
              'CrypterChat',
              style: TextStyle(
                color: Colors.white,
                fontSize: 32,
                fontWeight: FontWeight.w700,
              ),
            ),
            SizedBox(height: 8),
            Text('Connecting…', style: TextStyle(color: Colors.white70)),
          ],
        ),
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
  final _base = TextEditingController(text: defaultMessagingBaseUrl());
  bool _otpSent = false;
  bool _busy = false;
  String? _chainHint;
  String? _error;

  @override
  void initState() {
    super.initState();
    _probe();
  }

  Future<void> _probe() async {
    try {
      final api = ApiClient(baseUrl: _base.text.trim());
      final health = await api.health();
      final cs = health['chatscan'] as Map<String, dynamic>?;
      setState(() {
        _chainHint =
            'ChatScan ${cs?['chainId']} · height ${cs?['height']} · ${cs?['backend']}';
        _error = null;
      });
    } catch (e) {
      setState(() {
        _chainHint = null;
        _error = 'Bridge offline: $e';
      });
    }
  }

  Future<void> _requestOtp() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
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
            'CrypterChat needs your phone number so people can find you — just like a normal messaging app. Messages are sealed on ChatScan’s X11 chain; only hashes are public.',
            style: TextStyle(height: 1.4, color: Color(0xFF54656F)),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _base,
            decoration: const InputDecoration(
              labelText: 'Messaging bridge URL',
              helperText: 'Android emulator default: http://10.0.2.2:8787',
              border: OutlineInputBorder(),
            ),
            onChanged: (_) => _probe(),
          ),
          const SizedBox(height: 12),
          if (_chainHint != null)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFE7FCE3),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(_chainHint!, style: const TextStyle(color: Color(0xFF075E54))),
            ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 16),
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
  String? _chainLabel;
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
      final chain = await widget.api.chainStatus();
      final status = chain['status'] as Map<String, dynamic>?;
      if (!mounted) return;
      setState(() {
        _conversations = list;
        _chainLabel =
            'ChatScan ${status?['chainId']} · h${status?['height']} · ${status?['backend']}';
      });
    } catch (_) {
      /* keep last good state */
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
            tooltip: 'Refresh',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: () async {
              await SessionStore.clear();
              if (!mounted) return;
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
          if (_chainLabel != null)
            Container(
              width: double.infinity,
              color: const Color(0xFFDCF8C6),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                _chainLabel!,
                style: const TextStyle(color: Color(0xFF075E54), fontSize: 12),
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
                            backgroundColor: const Color(0xFFDFE5E7),
                            child: Text(
                              peerName.isEmpty ? '?' : peerName[0].toUpperCase(),
                              style: const TextStyle(color: Color(0xFF54656F)),
                            ),
                          ),
                          title: Text(
                            peerName,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(
                            c['lastPreview']?.toString() ?? 'Encrypted chat',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Color(0xFF667781)),
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
      final chain = result['chainRecord'] as Map<String, dynamic>?;
      _input.clear();
      if (message?['conversationId'] != null) {
        _conversationId = message!['conversationId'] as String;
      }
      setState(() {
        _toast =
            'On chain ${message?['ref']} · contentAvailable=${chain?['contentAvailable']}';
      });
      await _load();
    } catch (e) {
      setState(() => _toast = 'Send failed: $e');
    } finally {
      setState(() => _sending = false);
      Future.delayed(const Duration(seconds: 4), () {
        if (mounted) setState(() => _toast = null);
      });
    }
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
              backgroundColor: Color(0xFFDFE5E7),
              child: Icon(Icons.person, color: Color(0xFF54656F), size: 20),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.peerPhone,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  const Text('ChatScan sealed · end-to-end encrypted',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w400)),
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
              decoration: const BoxDecoration(
                color: Color(0xFFECE5DD),
                // subtle paper pattern via gradient — WhatsApp-like chat canvas
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0xFFECE5DD), Color(0xFFE5DDD3)],
                ),
              ),
              child: ListView.builder(
                controller: _scroll,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                itemCount: _messages.length,
                itemBuilder: (context, index) {
                  final m = _messages[index];
                  final mine = m['from'] == me;
                  return Align(
                    alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.of(context).size.width * 0.78,
                      ),
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
                      decoration: BoxDecoration(
                        color: mine ? const Color(0xFFDCF8C6) : Colors.white,
                        borderRadius: BorderRadius.only(
                          topLeft: const Radius.circular(10),
                          topRight: const Radius.circular(10),
                          bottomLeft: Radius.circular(mine ? 10 : 2),
                          bottomRight: Radius.circular(mine ? 2 : 10),
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
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            m['plaintext']?.toString() ?? '[encrypted]',
                            style: const TextStyle(fontSize: 16, height: 1.25),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'ref ${m['ref']}\n'
                            'hash ${m['ciphertextHash']}\n'
                            '${m['status']} · ${m['size']} B · private',
                            style: TextStyle(
                              fontSize: 10,
                              height: 1.25,
                              color: Colors.black.withOpacity(0.45),
                              fontFamily: 'monospace',
                            ),
                          ),
                        ],
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
              color: const Color(0xFF075E54),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text(_toast!,
                  style: const TextStyle(color: Colors.white, fontSize: 12)),
            ),
          SafeArea(
            top: false,
            child: Container(
              color: const Color(0xFFF0F2F5),
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
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
                          hintText: 'Message',
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
                      backgroundColor: const Color(0xFF00A884),
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
