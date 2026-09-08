#import "RNQRImageScanner.h"
#import <CoreImage/CoreImage.h>
#import <UIKit/UIKit.h>

@implementation RNQRImageScanner

RCT_EXPORT_MODULE(RNQRImageScanner)

RCT_EXPORT_METHOD(scanImage:(NSString *)uriString
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSURL *url = [NSURL URLWithString:uriString];
    if (!url) {
      url = [NSURL fileURLWithPath:uriString];
    }

    CIImage *ciImage = [CIImage imageWithContentsOfURL:url];
    if (!ciImage) {
      NSData *data = [NSData dataWithContentsOfURL:url];
      UIImage *uiImg = data ? [UIImage imageWithData:data] : nil;
      if (uiImg) {
        ciImage = [CIImage imageWithCGImage:uiImg.CGImage];
      }
    }

    if (!ciImage) {
      return resolve(@[]);
    }

    NSDictionary *opts = @{CIDetectorAccuracy: CIDetectorAccuracyHigh};
    CIDetector *detector = [CIDetector detectorOfType:CIDetectorTypeQRCode
                                              context:nil
                                             options:opts];
    NSArray *features = [detector featuresInImage:ciImage];

    NSMutableArray *results = [NSMutableArray array];
    for (CIQRCodeFeature *feature in features) {
      if (feature.messageString) {
        [results addObject:@{@"value": feature.messageString}];
      }
    }
    resolve(results);
  });
}

@end
