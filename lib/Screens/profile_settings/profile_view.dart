//*************   © Copyrighted by Thinkcreative_Technologies. An Exclusive item of Envato market. Make sure you have purchased a Regular License OR Extended license for the Source Code from Envato to use this product. See the License Defination attached with source code. *********************

import 'dart:async';
import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:crypterchat/Configs/Dbkeys.dart';
import 'package:crypterchat/Configs/Dbpaths.dart';
import 'package:crypterchat/Configs/app_constants.dart';
import 'package:crypterchat/Configs/optional_constants.dart';
import 'package:crypterchat/Models/DataModel.dart';
import 'package:crypterchat/Screens/calling_screen/pickup_layout.dart';
import 'package:crypterchat/Screens/chat_screen/chat.dart';
import 'package:crypterchat/Screens/status/components/formatStatusTime.dart';
import 'package:crypterchat/Services/Admob/admob.dart';
import 'package:crypterchat/Services/Providers/Observer.dart';
import 'package:crypterchat/Services/localization/language_constants.dart';
import 'package:crypterchat/Utils/call_utilities.dart';
import 'package:crypterchat/Utils/color_detector.dart';
import 'package:crypterchat/Utils/open_settings.dart';
import 'package:crypterchat/Utils/permissions.dart';
import 'package:crypterchat/Utils/theme_management.dart';
import 'package:crypterchat/Utils/utils.dart';
import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ProfileView extends StatefulWidget {
  final Map<String, dynamic> user;
  final String? currentUserNo;
  final DataModel? model;
  final SharedPreferences prefs;
  final DocumentSnapshot<Map<String, dynamic>>? firestoreUserDoc;
  final List<dynamic> mediaMesages;
  ProfileView(
      this.user, this.currentUserNo, this.model, this.prefs, this.mediaMesages,
      {this.firestoreUserDoc});

  @override
  State<ProfileView> createState() => _ProfileViewState();
}

class _ProfileViewState extends State<ProfileView> {
  call(BuildContext context, bool isvideocall) async {
    var mynickname = widget.prefs.getString(Dbkeys.nickname) ?? '';

    var myphotoUrl = widget.prefs.getString(Dbkeys.photoUrl) ?? '';

    CallUtils.dial(
        prefs: widget.prefs,
        currentuseruid: widget.currentUserNo,
        fromDp: myphotoUrl,
        toDp: widget.user[Dbkeys.photoUrl],
        fromUID: widget.currentUserNo,
        fromFullname: mynickname,
        toUID: widget.user[Dbkeys.phone],
        toFullname: widget.user[Dbkeys.nickname],
        context: context,
        isvideocall: isvideocall);
  }

  final BannerAd myBanner = BannerAd(
    adUnitId: getBannerAdUnitId()!,
    size: AdSize.banner,
    request: AdRequest(),
    listener: BannerAdListener(),
  );
  AdWidget? adWidget;
  StreamSubscription? chatStatusSubscriptionForPeer;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((timeStamp) {
      final observer = Provider.of<Observer>(this.context, listen: false);
      listenToBlock();
      if (IsBannerAdShow == true && observer.isadmobshow == true) {
        myBanner.load();
        adWidget = AdWidget(ad: myBanner);
        setState(() {});
      }
    });
  }

  bool hasPeerBlockedMe = false;
  listenToBlock() {
    chatStatusSubscriptionForPeer = FirebaseFirestore.instance
        .collection(DbPaths.collectionusers)
        .doc(widget.user[Dbkeys.phone])
        .collection(Dbkeys.chatsWith)
        .doc(Dbkeys.chatsWith)
        .snapshots()
        .listen((doc) {
      if (doc.data()!.containsKey(widget.currentUserNo)) {
        if (doc.data()![widget.currentUserNo] == 0) {
          hasPeerBlockedMe = true;
          setState(() {});
        } else if (doc.data()![widget.currentUserNo] == 3) {
          hasPeerBlockedMe = false;
          setState(() {});
        }
      }
    });
  }

  @override
  void dispose() {
    super.dispose();
    chatStatusSubscriptionForPeer?.cancel();
    if (IsBannerAdShow == true) {
      myBanner.dispose();
    }
  }

  buildBody(BuildContext context) {
    final observer = Provider.of<Observer>(context, listen: false);
    return Column(
      children: [
        Container(
          color: Thm.isDarktheme(widget.prefs)
              ? crypterchatCONTAINERboxColorDarkMode
              : crypterchatCONTAINERboxColorLightMode,
          padding: EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisSize: MainAxisSize.max,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    getTranslated(context, 'enter_mobilenumber'),
                    textAlign: TextAlign.left,
                    style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: crypterchatPRIMARYcolor,
                        fontSize: 16),
                  ),
                ],
              ),
              Divider(color: Colors.grey.withOpacity(0.11)),
              SizedBox(
                height: 0,
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    widget.user[Dbkeys.phone],
                    textAlign: TextAlign.left,
                    style: TextStyle(
                        fontWeight: FontWeight.normal,
                        color: pickTextColorBasedOnBgColorAdvanced(
                            Thm.isDarktheme(widget.prefs)
                                ? crypterchatCONTAINERboxColorDarkMode
                                : crypterchatCONTAINERboxColorLightMode),
                        fontSize: 15.3),
                  ),
                  Container(
                    child: Row(
                      children: [
                        if (widget.currentUserNo != widget.user[Dbkeys.phone])
                          observer.isCallFeatureTotallyHide == true ||
                                  observer.isOngoingCall
                              ? SizedBox()
                              : IconButton(
                                  onPressed: observer.iscallsallowed == false
                                      ? () {
                                          Crypterchat.showRationale(getTranslated(
                                              context, 'callnotallowed'));
                                        }
                                      : hasPeerBlockedMe == true
                                          ? () {
                                              Crypterchat.toast(
                                                getTranslated(
                                                    context, 'userhasblocked'),
                                              );
                                            }
                                          : () async {
                                              await Permissions
                                                      .cameraAndMicrophonePermissionsGranted()
                                                  .then((isgranted) {
                                                if (isgranted == true) {
                                                  call(context, false);
                                                } else {
                                                  Crypterchat.showRationale(
                                                      getTranslated(
                                                          context, 'pmc'));
                                                  Navigator.push(
                                                      context,
                                                      new MaterialPageRoute(
                                                          builder: (context) =>
                                                              OpenSettings(
                                                                permtype:
                                                                    'contact',
                                                                prefs: widget
                                                                    .prefs,
                                                              )));
                                                }
                                              }).catchError((onError) {
                                                Crypterchat.showRationale(
                                                    getTranslated(
                                                        context, 'pmc'));
                                                Navigator.push(
                                                    context,
                                                    new MaterialPageRoute(
                                                        builder: (context) =>
                                                            OpenSettings(
                                                              permtype:
                                                                  'contact',
                                                              prefs:
                                                                  widget.prefs,
                                                            )));
                                              });
                                            },
                                  icon: Icon(
                                    Icons.phone,
                                    color: crypterchatPRIMARYcolor,
                                  )),
                        if (widget.currentUserNo != widget.user[Dbkeys.phone])
                          observer.isCallFeatureTotallyHide == true ||
                                  observer.isOngoingCall
                              ? SizedBox()
                              : IconButton(
                                  onPressed: observer.iscallsallowed == false
                                      ? () {
                                          Crypterchat.showRationale(getTranslated(
                                              context, 'callnotallowed'));
                                        }
                                      : hasPeerBlockedMe == true
                                          ? () {
                                              Crypterchat.toast(
                                                getTranslated(
                                                    context, 'userhasblocked'),
                                              );
                                            }
                                          : () async {
                                              await Permissions
                                                      .cameraAndMicrophonePermissionsGranted()
                                                  .then((isgranted) {
                                                if (isgranted == true) {
                                                  call(context, true);
                                                } else {
                                                  Crypterchat.showRationale(
                                                      getTranslated(
                                                          context, 'pmc'));
                                                  Navigator.push(
                                                      context,
                                                      new MaterialPageRoute(
                                                          builder: (context) =>
                                                              OpenSettings(
                                                                permtype:
                                                                    'contact',
                                                                prefs: widget
                                                                    .prefs,
                                                              )));
                                                }
                                              }).catchError((onError) {
                                                Crypterchat.showRationale(
                                                    getTranslated(
                                                        context, 'pmc'));
                                                Navigator.push(
                                                    context,
                                                    new MaterialPageRoute(
                                                        builder: (context) =>
                                                            OpenSettings(
                                                              permtype:
                                                                  'contact',
                                                              prefs:
                                                                  widget.prefs,
                                                            )));
                                              });
                                            },
                                  icon: Icon(
                                    Icons.videocam_rounded,
                                    size: 26,
                                    color: crypterchatPRIMARYcolor,
                                  )),
                        if (widget.currentUserNo != widget.user[Dbkeys.phone])
                          IconButton(
                              onPressed: () {
                                if (widget.firestoreUserDoc != null) {
                                  widget.model!
                                      .addUser(widget.firestoreUserDoc!);
                                }

                                Navigator.pushAndRemoveUntil(
                                    context,
                                    new MaterialPageRoute(
                                        builder: (context) => ChatScreen(
                                            isSharingIntentForwarded: false,
                                            prefs: widget.prefs,
                                            model: widget.model!,
                                            currentUserNo: widget.currentUserNo,
                                            peerNo: widget.user[Dbkeys.phone],
                                            unread: 0)),
                                    (Route r) => r.isFirst);
                              },
                              icon: Icon(
                                Icons.message,
                                color: crypterchatPRIMARYcolor,
                              )),
                      ],
                    ),
                  )
                ],
              ),
              SizedBox(
                height: 0,
              ),
            ],
          ),
        ),
        SizedBox(
          height: 20,
        ),
        Container(
          padding: EdgeInsets.only(bottom: 18, top: 8),
          color: Thm.isDarktheme(widget.prefs)
              ? crypterchatCONTAINERboxColorDarkMode
              : crypterchatCONTAINERboxColorLightMode,
          // height: 30,
          child: ListTile(
            title: Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: Text(
                getTranslated(context, 'encryption'),
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  height: 2,
                  color: pickTextColorBasedOnBgColorAdvanced(
                      Thm.isDarktheme(widget.prefs)
                          ? crypterchatCONTAINERboxColorDarkMode
                          : crypterchatCONTAINERboxColorLightMode),
                ),
              ),
            ),
            dense: false,
            subtitle: Text(
              getTranslated(context, 'encryptionshort'),
              style: TextStyle(color: crypterchatGrey, height: 1.3, fontSize: 15),
            ),
            trailing: Padding(
              padding: const EdgeInsets.only(top: 32),
              child: Icon(
                Icons.lock,
                color: crypterchatPRIMARYcolor,
              ),
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final observer = Provider.of<Observer>(context, listen: false);

    var w = MediaQuery.of(context).size.width;
    return PickupLayout(
        prefs: widget.prefs,
        scaffold: Crypterchat.getNTPWrappedWidget(widget
                    .user[Dbkeys.accountstatus] ==
                Dbkeys.sTATUSdeleted
            ? Scaffold(
                backgroundColor: Thm.isDarktheme(widget.prefs)
                    ? crypterchatBACKGROUNDcolorDarkMode
                    : crypterchatBACKGROUNDcolorLightMode,
                appBar: AppBar(
                  backgroundColor: Thm.isDarktheme(widget.prefs)
                      ? crypterchatAPPBARcolorDarkMode
                      : crypterchatAPPBARcolorLightMode,
                  elevation: 0,
                ),
                body: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.delete_forever,
                        color: Colors.red,
                        size: 40,
                      ),
                      SizedBox(
                        height: 38,
                      ),
                      Text(" User Account Deleted"),
                    ],
                  ),
                ),
              )
            : Scaffold(
                backgroundColor: Thm.isDarktheme(widget.prefs)
                    ? crypterchatBACKGROUNDcolorDarkMode
                    : crypterchatBACKGROUNDcolorLightMode,
                bottomSheet: IsBannerAdShow == true &&
                        observer.isadmobshow == true &&
                        adWidget != null
                    ? Container(
                        height: 60,
                        margin: EdgeInsets.only(
                            bottom: Platform.isIOS == true ? 25.0 : 5, top: 0),
                        child: Center(child: adWidget),
                      )
                    : SizedBox(
                        height: 0,
                      ),
                // backgroundColor: crypterchatWhite,
                body: ListView(
                  children: [
                    Stack(
                      children: [
                        CachedNetworkImage(
                          imageUrl: widget.user[Dbkeys.photoUrl] ?? '',
                          imageBuilder: (context, imageProvider) => Container(
                            width: w,
                            height: w / 1.2,
                            decoration: BoxDecoration(
                              shape: BoxShape.rectangle,
                              image: DecorationImage(
                                  image: imageProvider, fit: BoxFit.cover),
                            ),
                          ),
                          placeholder: (context, url) => Container(
                            width: w,
                            height: w / 1.2,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.rectangle,
                            ),
                            child: Icon(Icons.person,
                                color: crypterchatGrey.withOpacity(0.5),
                                size: 95),
                          ),
                          errorWidget: (context, url, error) => Container(
                            width: w,
                            height: w / 1.2,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.rectangle,
                            ),
                            child: Icon(Icons.person,
                                color: crypterchatGrey.withOpacity(0.5),
                                size: 95),
                          ),
                        ),
                        Container(
                          width: w,
                          height: w / 1.2,
                          decoration: BoxDecoration(
                              gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.black.withOpacity(0.29),
                              Colors.black.withOpacity(0.48),
                            ],
                          )),
                        ),
                        Positioned(
                            bottom: 19,
                            left: 19,
                            child: SizedBox(
                              width: MediaQuery.of(context).size.width / 1.1,
                              child: Text(
                                widget.user[Dbkeys.nickname],
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 24,
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            )),
                        Positioned(
                          top: 11,
                          left: 7,
                          child: IconButton(
                            icon: Icon(
                              Icons.arrow_back_sharp,
                              size: 25,
                              color: crypterchatWhite,
                            ),
                            onPressed: () {
                              Navigator.of(context).pop();
                            },
                          ),
                        ),
                      ],
                    ),
                    Container(
                      color: Thm.isDarktheme(widget.prefs)
                          ? crypterchatCONTAINERboxColorDarkMode
                          : crypterchatCONTAINERboxColorLightMode,
                      padding: EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            mainAxisSize: MainAxisSize.max,
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                getTranslated(context, 'about'),
                                textAlign: TextAlign.left,
                                style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: crypterchatPRIMARYcolor,
                                    fontSize: 16),
                              ),
                            ],
                          ),
                          Divider(color: Colors.grey.withOpacity(0.11)),
                          SizedBox(
                            height: 7,
                          ),
                          Text(
                            widget.user[Dbkeys.aboutMe] == null ||
                                    widget.user[Dbkeys.aboutMe] == ''
                                ? '${getTranslated(context, 'heyim')} $Appname'
                                : widget.user[Dbkeys.aboutMe],
                            textAlign: TextAlign.left,
                            style: TextStyle(
                                fontWeight: FontWeight.normal,
                                color: pickTextColorBasedOnBgColorAdvanced(
                                    Thm.isDarktheme(widget.prefs)
                                        ? crypterchatCONTAINERboxColorDarkMode
                                        : crypterchatCONTAINERboxColorLightMode),
                                fontSize: 15.9),
                          ),
                          SizedBox(
                            height: 14,
                          ),
                          Text(
                            getJoinTime(widget.user[Dbkeys.joinedOn], context),
                            textAlign: TextAlign.left,
                            style: TextStyle(
                                fontWeight: FontWeight.normal,
                                color: crypterchatGrey,
                                fontSize: 13.3),
                          ),
                          SizedBox(
                            height: 7,
                          ),
                        ],
                      ),
                    ),
                    SizedBox(
                      height: 20,
                    ),
                    OnlyPeerWhoAreSavedInmyContactCanMessageOrCallMe == true
                        ? widget.user.containsKey(Dbkeys.deviceSavedLeads)
                            ? widget.user[Dbkeys.deviceSavedLeads]
                                    .contains(widget.currentUserNo)
                                ? buildBody(context)
                                : SizedBox(
                                    height: 40,
                                  )
                            : SizedBox()
                        : buildBody(context),
                    SizedBox(
                      height: IsBannerAdShow == true &&
                              observer.isadmobshow == true &&
                              adWidget != null
                          ? 90
                          : 20,
                    ),
                  ],
                ),
              )));
  }
}
