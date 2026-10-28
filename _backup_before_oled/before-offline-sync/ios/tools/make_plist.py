# Writes the app's Info.plist (binary, like Xcode does).
import plistlib, sys

out, version, build = sys.argv[1], sys.argv[2], sys.argv[3]
info = {
    "CFBundleDevelopmentRegion": "en",
    "CFBundleDisplayName": "Geek⁴u",
    "CFBundleExecutable": "Geek4u",
    "CFBundleIdentifier": "com.geek4u.app",
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleName": "Geek4u",
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": version,
    "CFBundleVersion": build,
    "CFBundleSupportedPlatforms": ["iPhoneOS"],
    "DTPlatformName": "iphoneos",
    "DTPlatformVersion": "15.6",
    "DTSDKName": "iphoneos15.6",
    "LSRequiresIPhoneOS": True,
    "MinimumOSVersion": "15.0",
    "UIDeviceFamily": [1, 2],
    "UIRequiredDeviceCapabilities": ["arm64"],
    "UILaunchScreen": {},
    "UIUserInterfaceStyle": "Dark",
    "UIStatusBarStyle": "UIStatusBarStyleLightContent",
    "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"],
    "UISupportedInterfaceOrientations~ipad": ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown",
                                              "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"],
    # The Geek4u server speaks plain http unless it sits behind https. Only NSAllowsArbitraryLoads:
    # iOS ignores it as soon as NSAllowsLocalNetworking or another ATS key is also present.
    "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True},
    "NSLocalNetworkUsageDescription": "Geek⁴u connects to your server when it's on your home network.",
    "NSCameraUsageDescription": "Take a photo or video to upload, like a profile picture.",
    "NSMicrophoneUsageDescription": "Record sound with a video you upload.",
    "NSPhotoLibraryUsageDescription": "Choose pictures to upload.",
    "NSPhotoLibraryAddUsageDescription": "Save pictures you hold down on to your photos.",
    "CFBundleIcons": {"CFBundlePrimaryIcon": {"CFBundleIconFiles": ["AppIcon60x60"]}},
    "CFBundleIcons~ipad": {"CFBundlePrimaryIcon": {"CFBundleIconFiles": ["AppIcon60x60", "AppIcon76x76", "AppIcon83.5x83.5"]}},
    # Hold the app icon: jump to a page, or change the server address.
    "UIApplicationShortcutItems": [
        {"UIApplicationShortcutItemType": "com.geek4u.app.open", "UIApplicationShortcutItemTitle": "Graph",
         "UIApplicationShortcutItemIconSymbolName": "chart.xyaxis.line", "UIApplicationShortcutItemUserInfo": {"path": "/"}},
        {"UIApplicationShortcutItemType": "com.geek4u.app.open", "UIApplicationShortcutItemTitle": "Journal",
         "UIApplicationShortcutItemIconSymbolName": "book", "UIApplicationShortcutItemUserInfo": {"path": "/journal"}},
        {"UIApplicationShortcutItemType": "com.geek4u.app.open", "UIApplicationShortcutItemTitle": "Forum",
         "UIApplicationShortcutItemIconSymbolName": "bubble.left.and.bubble.right", "UIApplicationShortcutItemUserInfo": {"path": "/Forum"}},
        {"UIApplicationShortcutItemType": "com.geek4u.app.server", "UIApplicationShortcutItemTitle": "Change server",
         "UIApplicationShortcutItemIconSymbolName": "arrow.left.arrow.right"},
    ],
}
with open(out, "wb") as f:
    plistlib.dump(info, f, fmt=plistlib.FMT_BINARY)
