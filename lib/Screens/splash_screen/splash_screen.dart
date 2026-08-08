//*************   © Copyrighted by Thinkcreative_Technologies. An Exclusive item of Envato market. Make sure you have purchased a Regular License OR Extended license for the Source Code from Envato to use this product. See the License Defination attached with source code. *********************

import 'package:crypterchat/Configs/app_constants.dart';
import 'package:flutter/material.dart';

class Splashscreen extends StatelessWidget {
  final bool? isShowOnlySpinner;

  Splashscreen({this.isShowOnlySpinner = false});
  @override
  Widget build(BuildContext context) {
    return IsSplashOnlySolidColor == true || this.isShowOnlySpinner == true
        ? Scaffold(
            backgroundColor: SplashBackgroundSolidColor,
            body: Center(
              child: CircularProgressIndicator(
                  valueColor:
                      AlwaysStoppedAnimation<Color>(crypterchatSECONDARYolor)),
            ))
        : Scaffold(
            backgroundColor: SplashBackgroundSolidColor,
            body: SafeArea(
              child: Stack(
                children: [
                  Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Image.asset(
                          'assets/appicon/appicon.png',
                          width: 130,
                          height: 130,
                        ),
                        SizedBox(height: 24),
                        Image.asset(
                          AppLogoPathLightModeLogo,
                          height: 38,
                          fit: BoxFit.contain,
                        ),
                      ],
                    ),
                  ),
                  Positioned(
                    bottom: 24,
                    left: 0,
                    right: 0,
                    child: Text(
                      MadeByText,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: crypterchatBlack.withOpacity(0.6),
                      ),
                    ),
                  )
                ],
              ),
            ),
          );
  }
}
