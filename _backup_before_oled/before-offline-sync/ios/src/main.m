// Geek⁴u for iPhone and iPad: the website in a full-screen web view, so it looks and works exactly
// like the site. The app adds what a browser would: uploads (photos, camera, files), downloads you
// can save to Files, swipe back, pull to refresh, opening other sites in Safari, Home Screen quick
// actions, and a screen to type the server's address the first time.

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

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

    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.allowsInlineMediaPlayback = YES;
    config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    config.applicationNameForUserAgent = @"Mobile/15E148 Geek4uApp/1.0 (iOS)";
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
        [self openSite:path ? [self.serverOrigin stringByAppendingString:path] : [self startPageURL]];
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
    if (last.length && [self isOwnSite:[NSURL URLWithString:last]]) return last;
    return [self.serverOrigin stringByAppendingString:@"/Main"];
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
    NSString *host = [NSURL URLWithString:self.serverOrigin].host;
    return host && [host caseInsensitiveCompare:url.host] == NSOrderedSame;
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
    [self hidePanel];
    self.failedPageURL = nil;
    if (changed || !self.siteView.URL) [self openSite:[origin stringByAppendingString:@"/Main"]];
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
        [self openSite:[self.serverOrigin stringByAppendingString:path]];
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
    NSDictionary *m = [message.body isKindOfClass:[NSDictionary class]] ? message.body : nil;
    NSString *type = m[@"type"];
    if ([type isEqualToString:@"connect"]) {
        [self useServer:m[@"origin"]];
    } else if ([type isEqualToString:@"cancel"]) {
        [self hidePanel];
        if (!self.siteView.URL && self.serverOrigin.length) [self openSite:[self startPageURL]];
    } else if ([type isEqualToString:@"retry"]) {
        NSString *url = self.failedPageURL ?: [self.serverOrigin stringByAppendingString:@"/Main"];
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
