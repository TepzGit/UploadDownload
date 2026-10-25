// Geek⁴u for iPhone and iPad: the website in a full-screen web view, so it looks and works exactly
// like the site. The app adds what a browser would: uploads (photos, camera, files), downloads you
// can save to Files, swipe back, pull to refresh, opening other sites in Safari, Home Screen quick
// actions, and a screen to type the server's address the first time.
//
// Offline: an http server is loaded through a small proxy inside the app (gkproxy.c) that keeps a
// copy of every page and file, so the Graph, Journal, Profile and Utility open without internet.
// Phone sync: the Files folders picked on the Profile are copied into the app's folder in the
// Files app ("On My iPhone › Geek⁴u") and kept matching the server.

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#include "gkproxy.h"

static const int kProxyPort = 42800;

// Put the site's address here (like @"https://example.com") to skip the setup screen.
static NSString *const kDefaultServer = @"http://87.61.252.240:42067";

static UIColor *Violet(void) { return [UIColor colorWithRed:0xa6 / 255.0 green:0x7c / 255.0 blue:0xff / 255.0 alpha:1]; }

@interface GKViewController : UIViewController <WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate>
@property (nonatomic, strong) WKWebView *siteView;
@property (nonatomic, strong) WKWebView *panelView;
@property (nonatomic, strong) UIView *progressLine;
@property (nonatomic, strong) UIImageView *splashView;
@property (nonatomic, strong) UIRefreshControl *refresher;
@property (nonatomic, copy) NSString *serverOrigin;
// What the web view loads: the proxy (http://127.0.0.1:42800) for an http server, else serverOrigin.
@property (nonatomic, copy) NSString *siteOrigin;
@property (nonatomic) BOOL proxyRestarted;
@property (nonatomic) BOOL syncing;
@property (nonatomic, strong) NSMutableDictionary *syncStatus;
@property (nonatomic, copy) NSString *failedPageURL;
@property (nonatomic, copy) NSString *panelMode;
@property (nonatomic, copy) NSString *pendingPanelScript;
@property (nonatomic) BOOL panelLoaded;
@property (nonatomic, strong) UIApplicationShortcutItem *pendingShortcut;
@property (nonatomic, strong) NSMutableArray<WKDownload *> *activeDownloads;
@property (nonatomic, strong) NSMutableDictionary<NSValue *, NSURL *> *downloadDestinations;
- (void)handleShortcut:(UIApplicationShortcutItem *)item;
@end

@implementation GKViewController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.blackColor;
    self.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
    self.activeDownloads = [NSMutableArray array];
    self.downloadDestinations = [NSMutableDictionary dictionary];
    [[NSFileManager defaultManager] removeItemAtPath:[NSTemporaryDirectory() stringByAppendingPathComponent:@"downloads"] error:nil];

    NSString *saved = [[NSUserDefaults standardUserDefaults] stringForKey:@"server"];
    self.serverOrigin = saved.length ? saved : kDefaultServer;
    [self startProxy];
    [self loadSyncStatus];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(cameBack)
                                                 name:UIApplicationWillEnterForegroundNotification object:nil];

    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.allowsInlineMediaPlayback = YES;
    config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    NSString *version = [NSBundle mainBundle].infoDictionary[@"CFBundleShortVersionString"] ?: @"1";
    config.applicationNameForUserAgent = [NSString stringWithFormat:@"Mobile/15E148 Geek4uApp/%@ (iOS)", version];
    [config.userContentController addScriptMessageHandler:self name:@"geek4uSync"];
    self.siteView = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:config];
    self.siteView.navigationDelegate = self;
    self.siteView.UIDelegate = self;
    self.siteView.allowsBackForwardNavigationGestures = YES;
    self.siteView.opaque = NO;
    self.siteView.backgroundColor = UIColor.blackColor;
    self.siteView.underPageBackgroundColor = UIColor.blackColor;
    self.siteView.scrollView.backgroundColor = UIColor.blackColor;
    self.siteView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    self.refresher = [UIRefreshControl new];
    self.refresher.tintColor = [UIColor colorWithWhite:0.85 alpha:1];
    [self.refresher addTarget:self action:@selector(pulledToRefresh) forControlEvents:UIControlEventValueChanged];
    self.siteView.scrollView.refreshControl = self.refresher;
    [self.siteView addObserver:self forKeyPath:@"estimatedProgress" options:NSKeyValueObservingOptionNew context:NULL];
    [self.view addSubview:self.siteView];

    self.progressLine = [UIView new];
    self.progressLine.backgroundColor = Violet();
    self.progressLine.alpha = 0;
    [self.view addSubview:self.progressLine];

    WKWebViewConfiguration *panelConfig = [WKWebViewConfiguration new];
    [panelConfig.userContentController addScriptMessageHandler:self name:@"geek4u"];
    self.panelView = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:panelConfig];
    self.panelView.navigationDelegate = self;
    self.panelView.opaque = NO;
    self.panelView.backgroundColor = UIColor.blackColor;
    self.panelView.scrollView.backgroundColor = UIColor.blackColor;
    self.panelView.hidden = YES;
    [self.view addSubview:self.panelView];
    NSURL *page = [[NSBundle mainBundle] URLForResource:@"panel" withExtension:@"html"];
    [self.panelView loadFileURL:page allowingReadAccessToURL:[NSBundle mainBundle].resourceURL];

    if (!self.serverOrigin.length) {
        [self showSetupWithPrefill:@"" canCancel:NO];
    } else {
        NSString *path = [self shortcutPath:self.pendingShortcut];
        [self openSite:path ? [self.siteOrigin stringByAppendingString:path] : [self startPageURL]];
        if ([self.pendingShortcut.type isEqualToString:@"com.geek4u.app.server"]) [self showSetupWithPrefill:self.serverOrigin canCancel:YES];
    }
    self.pendingShortcut = nil;
}

- (void)dealloc {
    [self.siteView removeObserver:self forKeyPath:@"estimatedProgress"];
}

- (UIStatusBarStyle)preferredStatusBarStyle {
    return UIStatusBarStyleLightContent;
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    // The page sits inside the safe area; the notch and home bar stay black like the site.
    UIEdgeInsets s = self.view.safeAreaInsets;
    CGRect b = self.view.bounds;
    CGRect safe = CGRectMake(s.left, s.top, b.size.width - s.left - s.right, b.size.height - s.top - s.bottom);
    self.siteView.frame = safe;
    self.panelView.frame = safe;
    [self layoutProgressLine];
    if (self.splashView) self.splashView.center = CGPointMake(CGRectGetMidX(b), CGRectGetMidY(b));
}

// ---------------------------------------------------------------- opening the site

- (void)openSite:(NSString *)url {
    NSURL *u = [NSURL URLWithString:url];
    if (!u) return;
    if (!self.siteView.URL && !self.splashView) [self showSplashLogo];
    [self.siteView loadRequest:[NSURLRequest requestWithURL:u]];
}

- (NSString *)startPageURL {
    NSString *last = [[NSUserDefaults standardUserDefaults] stringForKey:@"last"];
    NSURL *u = last.length ? [NSURL URLWithString:last] : nil;
    if (u && [self isOwnSite:u]) {
        // Saved before the offline proxy (or with another port): same page, through siteOrigin.
        NSURLComponents *c = [NSURLComponents componentsWithURL:u resolvingAgainstBaseURL:NO];
        NSString *rest = c.percentEncodedPath.length ? c.percentEncodedPath : @"/";
        if (c.percentEncodedQuery) rest = [rest stringByAppendingFormat:@"?%@", c.percentEncodedQuery];
        return [self.siteOrigin stringByAppendingString:rest];
    }
    return [self.siteOrigin stringByAppendingString:@"/Main"];
}

// ---------------------------------------------------------------- the offline proxy

- (void)startProxy {
    self.siteOrigin = self.serverOrigin;
    NSURL *u = [NSURL URLWithString:self.serverOrigin ?: @""];
    if (![u.scheme.lowercaseString isEqualToString:@"http"] || !u.host.length) return; // https: loaded directly
    NSString *caches = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
    NSString *dir = [caches stringByAppendingPathComponent:@"offline"];
    int port = u.port ? u.port.intValue : 80;
    if (gk_proxy_start(kProxyPort, u.host.UTF8String, port, dir.fileSystemRepresentation) == 0) {
        self.siteOrigin = [NSString stringWithFormat:@"http://127.0.0.1:%d", kProxyPort];
    }
}

- (BOOL)usesProxy {
    return ![self.siteOrigin isEqualToString:self.serverOrigin ?: @""];
}

// iOS can close a sleeping app's sockets: start the proxy again when the app comes back.
- (void)cameBack {
    if ([self usesProxy] && !gk_proxy_alive()) [self startProxy];
    NSTimeInterval last = [self.syncStatus[@"last"] doubleValue] / 1000;
    if (last > 0 && [NSDate date].timeIntervalSince1970 - last > 15 * 60) [self startSync];
}

// Remembers the page you were on, so the app opens there again (pages only, not pictures or files).
- (void)rememberPage {
    NSURL *u = self.siteView.URL;
    if (!u || self.failedPageURL || ![self isOwnSite:u]) return;
    if ([u.lastPathComponent containsString:@"."]) return;
    [[NSUserDefaults standardUserDefaults] setObject:u.absoluteString forKey:@"last"];
}

- (BOOL)isOwnSite:(NSURL *)url {
    if (!self.serverOrigin.length || !url.host) return NO;
    NSString *scheme = url.scheme.lowercaseString;
    if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) return NO;
    for (NSString *origin in @[self.serverOrigin, self.siteOrigin ?: self.serverOrigin]) {
        NSString *host = [NSURL URLWithString:origin].host;
        if (host && [host caseInsensitiveCompare:url.host] == NSOrderedSame) return YES;
    }
    return NO;
}

- (void)openOutside:(NSURL *)url {
    [[UIApplication sharedApplication] openURL:url options:@{} completionHandler:^(BOOL ok) {
        if (!ok) [self showAlertMessage:@"No app on this phone can open that link." completion:nil];
    }];
}

- (void)pulledToRefresh {
    if (self.siteView.URL) [self.siteView reload];
    else if (self.serverOrigin.length) [self openSite:[self startPageURL]];
    else [self.refresher endRefreshing];
}

- (void)useServer:(NSString *)origin {
    if (![origin isKindOfClass:[NSString class]] || !origin.length) return;
    BOOL changed = ![origin isEqualToString:self.serverOrigin ?: @""];
    self.serverOrigin = origin;
    NSUserDefaults *d = [NSUserDefaults standardUserDefaults];
    [d setObject:origin forKey:@"server"];
    if (changed) [d removeObjectForKey:@"last"];
    if (changed) [self startProxy];
    [self hidePanel];
    self.failedPageURL = nil;
    if (changed || !self.siteView.URL) [self openSite:[self.siteOrigin stringByAppendingString:@"/Main"]];
}

- (NSString *)shortcutPath:(UIApplicationShortcutItem *)item {
    if (![item.type isEqualToString:@"com.geek4u.app.open"]) return nil;
    id path = item.userInfo[@"path"];
    if (![path isKindOfClass:[NSString class]] || ![path hasPrefix:@"/"] || [path hasPrefix:@"//"]) return nil;
    return path;
}

- (void)handleShortcut:(UIApplicationShortcutItem *)item {
    if (!self.isViewLoaded) {
        self.pendingShortcut = item;
        return;
    }
    if (!self.serverOrigin.length) return;
    if ([item.type isEqualToString:@"com.geek4u.app.server"]) {
        [self showSetupWithPrefill:self.serverOrigin canCancel:YES];
        return;
    }
    NSString *path = [self shortcutPath:item];
    if (path) {
        if ([self.panelMode isEqualToString:@"error"]) [self hidePanel];
        self.failedPageURL = nil;
        [self openSite:[self.siteOrigin stringByAppendingString:path]];
    }
}

// ---------------------------------------------------------------- progress line and splash

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    if (object == self.siteView && [keyPath isEqualToString:@"estimatedProgress"]) {
        [self layoutProgressLine];
    } else {
        [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
    }
}

- (void)layoutProgressLine {
    double p = self.siteView.estimatedProgress;
    CGRect f = self.siteView.frame;
    BOOL loading = self.siteView.isLoading && p < 1;
    [UIView animateWithDuration:loading ? 0.18 : 0.25 animations:^{
        self.progressLine.frame = CGRectMake(f.origin.x, f.origin.y, f.size.width * (loading ? MAX(0.08, p) : 1), 2);
        self.progressLine.alpha = loading ? 1 : 0;
    }];
}

- (void)showSplashLogo {
    UIImage *logo = [UIImage imageNamed:@"Logo"];
    if (!logo) return;
    self.splashView = [[UIImageView alloc] initWithImage:logo];
    self.splashView.contentMode = UIViewContentModeScaleAspectFit;
    self.splashView.frame = CGRectMake(0, 0, 190, 190 * logo.size.height / logo.size.width);
    self.splashView.center = CGPointMake(CGRectGetMidX(self.view.bounds), CGRectGetMidY(self.view.bounds));
    [self.view insertSubview:self.splashView aboveSubview:self.siteView];
    self.siteView.alpha = 0;
    // Never keep it up forever, even if the page is slow to finish.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(12 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self hideSplashLogo];
    });
}

- (void)hideSplashLogo {
    UIImageView *s = self.splashView;
    self.splashView = nil;
    [UIView animateWithDuration:0.22 animations:^{
        s.alpha = 0;
        self.siteView.alpha = 1;
    } completion:^(BOOL done) {
        [s removeFromSuperview];
    }];
}

// ---------------------------------------------------------------- setup and error screens (panel.html)

- (void)showPanel:(NSDictionary *)state {
    NSData *json = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    NSString *js = [NSString stringWithFormat:@"show(%@)", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]];
    self.panelMode = state[@"mode"];
    self.panelView.hidden = NO;
    [self.view bringSubviewToFront:self.panelView];
    [self hideSplashLogo];
    if (self.panelLoaded) [self.panelView evaluateJavaScript:js completionHandler:nil];
    else self.pendingPanelScript = js;
}

- (void)showSetupWithPrefill:(NSString *)prefill canCancel:(BOOL)canCancel {
    [self showPanel:@{@"mode": @"setup", @"prefill": prefill ?: @"", @"canCancel": @(canCancel)}];
}

- (void)hidePanel {
    self.panelView.hidden = YES;
    self.panelMode = nil;
    [self.panelView endEditing:YES];
}

- (void)showLoadError:(NSError *)error {
    NSString *host = [NSURL URLWithString:self.serverOrigin].host ?: self.serverOrigin;
    NSString *message;
    // Through the proxy, a page that isn't saved on the phone comes back as a dropped connection.
    BOOL proxyMiss = [self usesProxy] && [error.domain isEqualToString:NSURLErrorDomain]
        && (error.code == NSURLErrorNetworkConnectionLost || error.code == NSURLErrorBadServerResponse
            || error.code == NSURLErrorCannotParseResponse || error.code == NSURLErrorZeroByteResource);
    if (proxyMiss) {
        [self.refresher endRefreshing];
        [self showPanel:@{@"mode": @"error",
                          @"message": @"This page needs internet, or your server is off. The Graph, Journal, your Profile and Utility work offline.",
                          @"server": self.serverOrigin ?: @"", @"canClose": @(self.siteView.URL != nil)}];
        return;
    }
    switch (error.code) {
        case NSURLErrorNotConnectedToInternet:
        case NSURLErrorNetworkConnectionLost:
            message = @"You're offline. Connect to the internet and try again.";
            break;
        case NSURLErrorCannotFindHost:
        case NSURLErrorDNSLookupFailed:
            message = [NSString stringWithFormat:@"The address %@ couldn't be found. Check it's typed right.", host];
            break;
        case NSURLErrorCannotConnectToHost:
            message = @"Your server didn't answer. Is it running?";
            break;
        case NSURLErrorTimedOut:
            message = @"Your server took too long to answer.";
            break;
        case NSURLErrorSecureConnectionFailed:
        case NSURLErrorServerCertificateHasBadDate:
        case NSURLErrorServerCertificateUntrusted:
        case NSURLErrorServerCertificateHasUnknownRoot:
        case NSURLErrorServerCertificateNotYetValid:
        case NSURLErrorClientCertificateRejected:
            message = @"A secure connection to your server couldn't be made.";
            break;
        default:
            message = error.localizedDescription ?: @"Something went wrong loading the page.";
    }
    [self.refresher endRefreshing];
    // A page that didn't load leaves the one before it showing, so "Go back" just closes this.
    [self showPanel:@{@"mode": @"error", @"message": message, @"server": self.serverOrigin ?: @"", @"canClose": @(self.siteView.URL != nil)}];
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if ([message.name isEqualToString:@"geek4uSync"]) {
        if ([message.body isEqual:@"sync"]) [self startSync];
        else [self pushSyncStatus];
        return;
    }
    NSDictionary *m = [message.body isKindOfClass:[NSDictionary class]] ? message.body : nil;
    NSString *type = m[@"type"];
    if ([type isEqualToString:@"connect"]) {
        [self useServer:m[@"origin"]];
    } else if ([type isEqualToString:@"cancel"]) {
        [self hidePanel];
        if (!self.siteView.URL && self.serverOrigin.length) [self openSite:[self startPageURL]];
    } else if ([type isEqualToString:@"retry"]) {
        NSString *url = self.failedPageURL ?: [self.siteOrigin stringByAppendingString:@"/Main"];
        self.failedPageURL = nil;
        [self hidePanel];
        [self openSite:url];
    } else if ([type isEqualToString:@"close"]) {
        self.failedPageURL = nil;
        [self hidePanel];
    } else if ([type isEqualToString:@"change"]) {
        [self showSetupWithPrefill:self.serverOrigin canCancel:YES];
    }
}

// ---------------------------------------------------------------- navigation

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    if (webView != self.siteView) {
        decisionHandler([action.request.URL isFileURL] ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
        return;
    }
    if (action.shouldPerformDownload) {
        decisionHandler(WKNavigationActionPolicyDownload);
        return;
    }
    NSURL *url = action.request.URL;
    NSString *scheme = url.scheme.lowercaseString ?: @"";
    BOOL mainFrame = action.targetFrame == nil || action.targetFrame.isMainFrame;
    if ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"]) {
        // Frames inside a page are left alone; only whole-page moves to another site go to Safari.
        if (!mainFrame || [self isOwnSite:url]) {
            decisionHandler(WKNavigationActionPolicyAllow);
        } else {
            [self openOutside:url];
            decisionHandler(WKNavigationActionPolicyCancel);
        }
        return;
    }
    if ([@[@"about", @"data", @"blob", @"javascript"] containsObject:scheme]) {
        decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }
    [self openOutside:url];
    decisionHandler(WKNavigationActionPolicyCancel);
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationResponse:(WKNavigationResponse *)response
    decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
    if (webView == self.siteView && response.isForMainFrame) {
        NSString *disposition = nil;
        if ([response.response isKindOfClass:[NSHTTPURLResponse class]]) {
            disposition = [(NSHTTPURLResponse *)response.response valueForHTTPHeaderField:@"Content-Disposition"];
        }
        if ([disposition.lowercaseString hasPrefix:@"attachment"] || !response.canShowMIMEType) {
            decisionHandler(WKNavigationResponsePolicyDownload);
            return;
        }
    }
    decisionHandler(WKNavigationResponsePolicyAllow);
}

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation {
    [self layoutProgressLine];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    if (webView == self.panelView) {
        self.panelLoaded = YES;
        if (self.pendingPanelScript) [self.panelView evaluateJavaScript:self.pendingPanelScript completionHandler:nil];
        self.pendingPanelScript = nil;
        return;
    }
    self.failedPageURL = nil;
    self.proxyRestarted = NO;
    if ([self.panelMode isEqualToString:@"error"]) [self hidePanel];
    [self hideSplashLogo];
    [self.refresher endRefreshing];
    [self layoutProgressLine];
    [self rememberPage];
}

- (BOOL)isIgnorableError:(NSError *)error {
    // Cancelled loads, and pages that turned into downloads.
    if ([error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorCancelled) return YES;
    if ([error.domain isEqualToString:@"WebKitErrorDomain"] && (error.code == 102 || error.code == 204)) return YES;
    return NO;
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self layoutProgressLine];
    if (webView != self.siteView || [self isIgnorableError:error]) {
        [self.refresher endRefreshing];
        return;
    }
    NSString *failing = error.userInfo[NSURLErrorFailingURLStringErrorKey];
    self.failedPageURL = [failing isKindOfClass:[NSString class]] ? failing : webView.URL.absoluteString;
    // The proxy was gone (the phone slept): start it again and load the page once more.
    if ([self usesProxy] && !gk_proxy_alive() && !self.proxyRestarted && self.failedPageURL) {
        self.proxyRestarted = YES;
        [self startProxy];
        [self openSite:self.failedPageURL];
        return;
    }
    self.proxyRestarted = NO;
    [self showLoadError:error];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self.refresher endRefreshing];
    [self layoutProgressLine];
}

// The page's web process crashed or was stopped to free memory: load it again where you were.
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    if (webView.URL) [webView reload];
    else if (webView == self.siteView && self.serverOrigin.length) [self openSite:[self startPageURL]];
}

// Links that open a new window (target=_blank): your pages open here, other sites in Safari.
- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
    forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)windowFeatures {
    NSURL *url = action.request.URL;
    if ([self isOwnSite:url]) [self.siteView loadRequest:action.request];
    else if (url) [self openOutside:url];
    return nil;
}

// ---------------------------------------------------------------- page dialogs

- (void)showAlertMessage:(NSString *)message completion:(void (^)(void))completion {
    UIAlertController *a = [UIAlertController alertControllerWithTitle:nil message:message preferredStyle:UIAlertControllerStyleAlert];
    [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:^(UIAlertAction *x) {
        if (completion) completion();
    }]];
    if (![self presentPopup:a] && completion) completion();
}

// Shows a popup over whatever is up; NO when nothing can be shown right now.
- (BOOL)presentPopup:(UIViewController *)vc {
    UIViewController *top = self;
    while (top.presentedViewController) top = top.presentedViewController;
    if (top.isBeingDismissed || top.isBeingPresented) return NO;
    vc.view.tintColor = Violet();
    [top presentViewController:vc animated:YES completion:nil];
    return YES;
}

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    [self showAlertMessage:message completion:completionHandler];
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    UIAlertController *a = [UIAlertController alertControllerWithTitle:nil message:message preferredStyle:UIAlertControllerStyleAlert];
    [a addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:^(UIAlertAction *x) {
        completionHandler(NO);
    }]];
    [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:^(UIAlertAction *x) {
        completionHandler(YES);
    }]];
    if (![self presentPopup:a]) completionHandler(NO);
}

- (void)webView:(WKWebView *)webView runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt defaultText:(NSString *)defaultText
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSString *))completionHandler {
    UIAlertController *a = [UIAlertController alertControllerWithTitle:nil message:prompt preferredStyle:UIAlertControllerStyleAlert];
    [a addTextFieldWithConfigurationHandler:^(UITextField *field) {
        field.text = defaultText;
    }];
    __weak UIAlertController *weakAlert = a;
    [a addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:^(UIAlertAction *x) {
        completionHandler(nil);
    }]];
    [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:^(UIAlertAction *x) {
        completionHandler(weakAlert.textFields.firstObject.text ?: @"");
    }]];
    if (![self presentPopup:a]) completionHandler(nil);
}

// ---------------------------------------------------------------- downloads: saved, then offered in the share sheet

- (void)webView:(WKWebView *)webView navigationAction:(WKNavigationAction *)navigationAction didBecomeDownload:(WKDownload *)download {
    download.delegate = self;
    [self.activeDownloads addObject:download];
}

- (void)webView:(WKWebView *)webView navigationResponse:(WKNavigationResponse *)navigationResponse didBecomeDownload:(WKDownload *)download {
    download.delegate = self;
    [self.activeDownloads addObject:download];
}

- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response
    suggestedFilename:(NSString *)suggestedFilename completionHandler:(void (^)(NSURL *))completionHandler {
    NSString *dir = [[NSTemporaryDirectory() stringByAppendingPathComponent:@"downloads"] stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *name = suggestedFilename.lastPathComponent;
    if (!name.length || [name isEqualToString:@"/"]) name = @"download";
    NSURL *file = [NSURL fileURLWithPath:[dir stringByAppendingPathComponent:name]];
    self.downloadDestinations[[NSValue valueWithNonretainedObject:download]] = file;
    completionHandler(file);
}

- (void)downloadDidFinish:(WKDownload *)download {
    NSValue *key = [NSValue valueWithNonretainedObject:download];
    NSURL *file = self.downloadDestinations[key];
    [self.downloadDestinations removeObjectForKey:key];
    [self.activeDownloads removeObject:download];
    if (!file) return;
    UIActivityViewController *share = [[UIActivityViewController alloc] initWithActivityItems:@[file] applicationActivities:nil];
    share.popoverPresentationController.sourceView = self.view;
    share.popoverPresentationController.sourceRect = CGRectMake(CGRectGetMidX(self.view.bounds), CGRectGetMidY(self.view.bounds), 1, 1);
    share.popoverPresentationController.permittedArrowDirections = 0;
    [self presentPopup:share];
}

- (void)download:(WKDownload *)download didFailWithError:(NSError *)error resumeData:(NSData *)resumeData {
    [self.downloadDestinations removeObjectForKey:[NSValue valueWithNonretainedObject:download]];
    [self.activeDownloads removeObject:download];
    [self showAlertMessage:[@"Couldn't download that. " stringByAppendingString:error.localizedDescription ?: @""] completion:nil];
}

// ---------------------------------------------------------------- phone sync (the Profile's "Phone sync")

// Synced folders go in Documents, which the Files app shows as On My iPhone › Geek⁴u.
- (NSString *)syncRoot {
    return NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
}

- (NSString *)syncIndexPath {
    NSString *support = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
    [[NSFileManager defaultManager] createDirectoryAtPath:support withIntermediateDirectories:YES attributes:nil error:nil];
    return [support stringByAppendingPathComponent:@"sync-index.json"];
}

- (NSMutableDictionary *)readSyncIndex {
    NSData *data = [NSData dataWithContentsOfFile:[self syncIndexPath]];
    id index = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil] : nil;
    if (![index isKindOfClass:[NSMutableDictionary class]]) index = [NSMutableDictionary dictionary];
    if (![index[@"files"] isKindOfClass:[NSMutableDictionary class]]) index[@"files"] = [NSMutableDictionary dictionary];
    return index;
}

- (void)writeSyncIndex:(NSDictionary *)index {
    NSData *data = [NSJSONSerialization dataWithJSONObject:index options:0 error:nil];
    [data writeToFile:[self syncIndexPath] atomically:YES];
}

- (void)loadSyncStatus {
    NSDictionary *index = [self readSyncIndex];
    self.syncStatus = [@{@"state": @"idle", @"where": @"Files › On My iPhone › Geek⁴u",
                         @"last": index[@"last"] ?: @0, @"files": @([index[@"files"] count]),
                         @"bytes": index[@"bytes"] ?: @0} mutableCopy];
}

- (void)pushSyncStatus {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSData *json = [NSJSONSerialization dataWithJSONObject:self.syncStatus options:0 error:nil];
        if (!json) return;
        NSString *js = [NSString stringWithFormat:@"window.xnSyncStatus&&window.xnSyncStatus(%@)",
                        [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]];
        [self.siteView evaluateJavaScript:js completionHandler:nil];
    });
}

- (void)setSyncState:(NSString *)state done:(NSInteger)done total:(NSInteger)total error:(NSString *)error {
    dispatch_async(dispatch_get_main_queue(), ^{
        self.syncStatus[@"state"] = state;
        self.syncStatus[@"done"] = @(done);
        self.syncStatus[@"total"] = @(total);
        if (error) self.syncStatus[@"error"] = error;
        else [self.syncStatus removeObjectForKey:@"error"];
        [self pushSyncStatus];
    });
}

// "a/b/c.jpg" from the server, or nil when it tries to leave the folder.
static NSString *CleanSyncPath(id p) {
    if (![p isKindOfClass:[NSString class]]) return nil;
    NSMutableArray *parts = [NSMutableArray array];
    for (NSString *part in [[p stringByReplacingOccurrencesOfString:@"\\" withString:@"/"] componentsSeparatedByString:@"/"]) {
        if (!part.length || [part isEqualToString:@"."]) continue;
        if ([part isEqualToString:@".."]) return nil;
        [parts addObject:part];
    }
    return parts.count ? [parts componentsJoinedByString:@"/"] : nil;
}

- (void)startSync {
    if (self.syncing || !self.siteOrigin.length) return;
    self.syncing = YES;
    [self setSyncState:@"running" done:0 total:0 error:nil];
    NSString *origin = self.siteOrigin;
    NSString *host = [NSURL URLWithString:origin].host;
    // The web view's sign-in cookie goes with the requests (they go through the proxy too).
    [self.siteView.configuration.websiteDataStore.httpCookieStore getAllCookies:^(NSArray<NSHTTPCookie *> *all) {
        NSMutableArray *mine = [NSMutableArray array];
        for (NSHTTPCookie *c in all) {
            NSString *domain = [c.domain hasPrefix:@"."] ? [c.domain substringFromIndex:1] : c.domain;
            if ([domain caseInsensitiveCompare:host] == NSOrderedSame) [mine addObject:c];
        }
        NSDictionary *headers = [NSHTTPCookie requestHeaderFieldsWithCookies:mine];
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            NSString *problem = [self syncFrom:origin headers:headers];
            dispatch_async(dispatch_get_main_queue(), ^{
                self.syncing = NO;
                if (problem) [self setSyncState:@"error" done:0 total:0 error:problem];
            });
        });
    }];
}

// Runs on a background queue. Answers nil when everything is copied, else what went wrong.
- (NSString *)syncFrom:(NSString *)origin headers:(NSDictionary *)headers {
    NSURLSessionConfiguration *cfg = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    cfg.HTTPCookieStorage = nil;
    cfg.HTTPShouldSetCookies = NO;
    cfg.timeoutIntervalForRequest = 60;
    cfg.HTTPAdditionalHeaders = headers;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:cfg];
    NSFileManager *fm = [NSFileManager defaultManager];

    __block NSData *body = nil;
    __block NSHTTPURLResponse *response = nil;
    __block NSError *failure = nil;
    dispatch_semaphore_t wait = dispatch_semaphore_create(0);
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:[origin stringByAppendingString:@"/sync/manifest"]]];
    [[session dataTaskWithRequest:req completionHandler:^(NSData *d, NSURLResponse *r, NSError *e) {
        body = d;
        response = (NSHTTPURLResponse *)r;
        failure = e;
        dispatch_semaphore_signal(wait);
    }] resume];
    dispatch_semaphore_wait(wait, DISPATCH_TIME_FOREVER);
    if (failure) {
        [session invalidateAndCancel];
        return @"Couldn't reach the server. Sync will try again later.";
    }
    NSString *type = [response valueForHTTPHeaderField:@"Content-Type"] ?: @"";
    if (response.statusCode == 403) {
        [session invalidateAndCancel];
        return @"Sync stopped: your account has no Files access.";
    }
    if (response.statusCode != 200 || ![type containsString:@"json"]) {
        [session invalidateAndCancel];
        return @"Sync stopped: log in again in the app.";
    }
    NSDictionary *manifest = [NSJSONSerialization JSONObjectWithData:body options:0 error:nil];
    NSArray *list = [manifest isKindOfClass:[NSDictionary class]] && [manifest[@"files"] isKindOfClass:[NSArray class]] ? manifest[@"files"] : @[];

    NSMutableDictionary *index = [self readSyncIndex];
    NSMutableDictionary *have = index[@"files"];
    NSString *root = [self syncRoot];
    NSMutableSet *wanted = [NSMutableSet set];
    NSInteger total = list.count, done = 0, failed = 0, netErrors = 0;
    long long bytes = 0;
    NSDate *lastSave = [NSDate date];
    for (NSDictionary *f in list) {
        NSString *path = [f isKindOfClass:[NSDictionary class]] ? CleanSyncPath(f[@"path"]) : nil;
        if (!path) {
            total--;
            continue;
        }
        [wanted addObject:path];
        long long size = [f[@"size"] longLongValue], mtime = [f[@"mtime"] longLongValue];
        NSString *target = [root stringByAppendingPathComponent:path];
        NSDictionary *old = have[path];
        BOOL same = [old isKindOfClass:[NSDictionary class]] && [old[@"size"] longLongValue] == size
            && [old[@"mtime"] longLongValue] == mtime && [fm fileExistsAtPath:target];
        if (!same) {
            NSURLComponents *u = [NSURLComponents componentsWithString:[origin stringByAppendingString:@"/sync/file"]];
            u.queryItems = @[[NSURLQueryItem queryItemWithName:@"path" value:path]];
            __block NSURL *downloaded = nil;
            __block NSInteger code = 0;
            __block NSError *err = nil;
            NSString *tmp = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
            [[session downloadTaskWithURL:u.URL completionHandler:^(NSURL *location, NSURLResponse *r, NSError *e) {
                code = [(NSHTTPURLResponse *)r statusCode];
                err = e;
                // The file at location is removed when this returns: move it first.
                if (location && !e && [fm moveItemAtPath:location.path toPath:tmp error:nil]) downloaded = [NSURL fileURLWithPath:tmp];
                dispatch_semaphore_signal(wait);
            }] resume];
            dispatch_semaphore_wait(wait, DISPATCH_TIME_FOREVER);
            // The server went away mid-sync: stop, and try again later.
            netErrors = err ? netErrors + 1 : 0;
            if (netErrors >= 3) {
                [fm removeItemAtPath:tmp error:nil];
                [self writeSyncIndex:index];
                [session invalidateAndCancel];
                return @"Couldn't reach the server. Sync will try again later.";
            }
            if (downloaded && code == 200) {
                [fm createDirectoryAtPath:[target stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];
                [fm removeItemAtPath:target error:nil];
                if ([fm moveItemAtPath:tmp toPath:target error:nil]) {
                    NSURL *t = [NSURL fileURLWithPath:target];
                    [t setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil]; // it's on the server already
                    have[path] = @{@"size": @(size), @"mtime": @(mtime)};
                } else {
                    failed++;
                }
            } else {
                [fm removeItemAtPath:tmp error:nil];
                failed++;
            }
        }
        if (have[path]) bytes += size;
        done++;
        if (-lastSave.timeIntervalSinceNow > 1.5) {
            [self writeSyncIndex:index];
            lastSave = [NSDate date];
            [self setSyncState:@"running" done:done total:total error:nil];
        }
    }
    [session finishTasksAndInvalidate];

    // Gone from the server, or in a folder that was unticked.
    for (NSString *path in [have allKeys]) {
        if ([wanted containsObject:path]) continue;
        NSString *target = [root stringByAppendingPathComponent:path];
        [fm removeItemAtPath:target error:nil];
        [have removeObjectForKey:path];
        // Tidy folders left empty.
        NSString *dir = [target stringByDeletingLastPathComponent];
        while (dir.length > root.length && [[fm contentsOfDirectoryAtPath:dir error:nil] count] == 0) {
            [fm removeItemAtPath:dir error:nil];
            dir = [dir stringByDeletingLastPathComponent];
        }
    }

    double now = floor([NSDate date].timeIntervalSince1970 * 1000);
    index[@"last"] = @(now);
    index[@"bytes"] = @(bytes);
    [self writeSyncIndex:index];
    NSUInteger count = have.count;
    dispatch_async(dispatch_get_main_queue(), ^{
        self.syncStatus[@"last"] = @(now);
        self.syncStatus[@"files"] = @(count);
        self.syncStatus[@"bytes"] = @(bytes);
    });
    if (failed) return [NSString stringWithFormat:@"%ld %@ couldn't be copied. Sync will try again.", (long)failed, failed == 1 ? @"file" : @"files"];
    [self setSyncState:@"idle" done:done total:total error:nil];
    return nil;
}

@end

// ---------------------------------------------------------------- app

@interface GKAppDelegate : UIResponder <UIApplicationDelegate>
@property (nonatomic, strong) UIWindow *window;
@end

@implementation GKAppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.window.backgroundColor = UIColor.blackColor;
    self.window.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
    self.window.tintColor = Violet();
    GKViewController *vc = [GKViewController new];
    UIApplicationShortcutItem *item = options[UIApplicationLaunchOptionsShortcutItemKey];
    vc.pendingShortcut = item;
    self.window.rootViewController = vc;
    [self.window makeKeyAndVisible];
    // NO tells iOS the quick action was handled here, so it isn't sent again below.
    return item == nil;
}

- (void)application:(UIApplication *)application performActionForShortcutItem:(UIApplicationShortcutItem *)item
    completionHandler:(void (^)(BOOL))completionHandler {
    [(GKViewController *)self.window.rootViewController handleShortcut:item];
    completionHandler(YES);
}

@end

int main(int argc, char *argv[]) {
    @autoreleasepool {
        return UIApplicationMain(argc, argv, nil, NSStringFromClass([GKAppDelegate class]));
    }
}
