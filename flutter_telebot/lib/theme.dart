import 'package:flutter/material.dart';

class TeleBotTheme {
  // Brand Accents
  static const Color primaryCoral = Color(0xFFFF5722);
  static const Color primaryCoralHover = Color(0xFFF4511E);
  static const Color accentPlumDark = Color(0xFF270C20);
  static const Color accentPlumCard = Color(0xFF3B1331);
  static const Color successGreen = Color(0xFF10B981);
  static const Color warningOrange = Color(0xFFF59E0B);
  static const Color errorRed = Color(0xFFEF4444);

  // 1. NIGHT MODE (Dark OLED)
  static final ThemeData darkTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: const Color(0xFF090E17),
    colorScheme: const ColorScheme.dark(
      primary: primaryCoral,
      secondary: Color(0xFF38BDF8),
      surface: Color(0xFF131C2E),
      onPrimary: Colors.white,
      onSurface: Color(0xFFF8FAFC),
    ),
    cardTheme: CardTheme(
      color: const Color(0xFF131C2E),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFF1E293B), width: 1),
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: accentPlumDark,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: Color(0xFF0D1422),
      selectedItemColor: primaryCoral,
      unselectedItemColor: Color(0xFF64748B),
      type: BottomNavigationBarType.fixed,
      elevation: 12,
    ),
  );

  // 2. DAY MODE (Crisp & Clean Light)
  static final ThemeData lightTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: const Color(0xFFF1F5F9),
    colorScheme: const ColorScheme.light(
      primary: primaryCoral,
      secondary: Color(0xFF0284C7),
      surface: Colors.white,
      onPrimary: Colors.white,
      onSurface: Color(0xFF0F172A),
    ),
    cardTheme: CardTheme(
      color: Colors.white,
      elevation: 2,
      shadowColor: Colors.black.withOpacity(0.04),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFE2E8F0), width: 1),
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: Color(0xFF0F172A),
      elevation: 0,
      centerTitle: false,
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: Colors.white,
      selectedItemColor: primaryCoral,
      unselectedItemColor: Color(0xFF94A3B8),
      type: BottomNavigationBarType.fixed,
      elevation: 12,
    ),
  );
}
