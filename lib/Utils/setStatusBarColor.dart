import 'package:crypterchat/Configs/app_constants.dart';
import 'package:crypterchat/Utils/color_detector.dart';
import 'package:crypterchat/Utils/theme_management.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

setStatusBarColor(SharedPreferences prefs) {
  if (Thm.isDarktheme(prefs) == true) {
    SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle(
        statusBarColor: crypterchatAPPBARcolorDarkMode,
        statusBarIconBrightness: isDarkColor(crypterchatAPPBARcolorDarkMode)
            ? Brightness.light
            : Brightness.dark));
  } else {
    SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle(
        statusBarColor: crypterchatAPPBARcolorLightMode,
        statusBarIconBrightness: isDarkColor(crypterchatAPPBARcolorLightMode)
            ? Brightness.light
            : Brightness.dark));
  }
}
