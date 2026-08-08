// ChatScan blockchain bridge for CrypterChat.
//
// Phone login stays on Firebase Auth. When a message is sent, this service
// records a ciphertext digest on ChatScan's X11 chain. The explorer never
// receives plaintext — only hashes and opaque metadata.

import 'dart:convert';

import 'package:crypterchat/Configs/optional_constants.dart';
import 'package:http/http.dart' as http;

class ChatScanRecord {
  ChatScanRecord({
    required this.ref,
    required this.explorerUrl,
    required this.ciphertextHash,
    required this.status,
    required this.contentAvailable,
    this.commitment,
    this.size,
  });

  final String ref;
  final String explorerUrl;
  final String ciphertextHash;
  final String status;
  final bool contentAvailable;
  final String? commitment;
  final int? size;

  factory ChatScanRecord.fromJson(Map<String, dynamic> json) {
    final message = (json['message'] as Map?)?.cast<String, dynamic>() ?? {};
    final chain = (json['chainRecord'] as Map?)?.cast<String, dynamic>() ?? {};
    return ChatScanRecord(
      ref: '${message['ref'] ?? ''}',
      explorerUrl: '${message['explorerUrl'] ?? ''}',
      ciphertextHash: '${message['ciphertextHash'] ?? chain['ciphertextHash'] ?? ''}',
      status: '${message['status'] ?? chain['status'] ?? ''}',
      contentAvailable: chain['contentAvailable'] == true,
      commitment: message['commitment']?.toString(),
      size: message['size'] is int ? message['size'] as int : null,
    );
  }
}

class ChatScanService {
  ChatScanService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = (baseUrl ?? ChatScanMessagingBaseUrl).replaceAll(RegExp(r'/+$'), '');

  final http.Client _client;
  final String _baseUrl;
  String? _token;

  bool get isConfigured =>
      EnableChatScanBlockchain && _baseUrl.isNotEmpty;

  /// Optional session against the messaging bridge (phone OTP demo API).
  Future<void> ensureSession({
    required String phone,
    String displayName = 'CrypterChat User',
  }) async {
    if (!isConfigured || _token != null) return;
    await _client.post(
      Uri.parse('$_baseUrl/api/auth/request-otp'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'phone': phone, 'displayName': displayName}),
    );
    final verified = await _client.post(
      Uri.parse('$_baseUrl/api/auth/verify-otp'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({
        'phone': phone,
        'displayName': displayName,
        'code': ChatScanDemoOtp,
      }),
    );
    if (verified.statusCode >= 200 && verified.statusCode < 300) {
      final body = jsonDecode(verified.body) as Map<String, dynamic>;
      _token = body['token']?.toString();
    }
  }

  /// Encrypt + commit through the messaging bridge / ChatScan X11 chain.
  /// Returns null when ChatScan is disabled or unreachable (non-fatal).
  Future<ChatScanRecord?> recordMessage({
    required String fromPhone,
    required String toPhone,
    required String plaintext,
  }) async {
    if (!isConfigured) return null;
    try {
      await ensureSession(phone: fromPhone);
      final res = await _client.post(
        Uri.parse('$_baseUrl/api/messages/send'),
        headers: {
          'content-type': 'application/json',
          if (_token != null) 'authorization': 'Bearer $_token',
        },
        body: jsonEncode({'to': toPhone, 'text': plaintext}),
      );
      if (res.statusCode < 200 || res.statusCode >= 300) {
        // Do not block local chat delivery if the chain bridge is down.
        return null;
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final record = ChatScanRecord.fromJson(body);
      if (record.contentAvailable) {
        throw StateError('ChatScan leaked contentAvailable=true');
      }
      return record;
    } catch (_) {
      return null;
    }
  }
}

/// Shared singleton used by chat screens.
final chatScanService = ChatScanService();
