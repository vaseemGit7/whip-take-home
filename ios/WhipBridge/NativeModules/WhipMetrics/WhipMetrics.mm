#import <React/RCTBridgeModule.h>

// Maximum latency samples retained per capability (ring buffer cap)
static const NSUInteger kMaxSamples = 500;

@interface WhipMetrics : NSObject <RCTBridgeModule>
@end

@implementation WhipMetrics {
  dispatch_queue_t _queue;

  // Wall-clock timestamps (ms) of recent requests — trimmed to last 5 s
  NSMutableArray<NSNumber *> *_requestTimestamps;

  // Per-capability latency samples (ms) — capped at kMaxSamples
  NSMutableDictionary<NSString *, NSMutableArray<NSNumber *> *> *_latencies;

  // Per-capability counters
  NSMutableDictionary<NSString *, NSNumber *> *_totals;
  NSMutableDictionary<NSString *, NSNumber *> *_errors;

  NSInteger _droppedTotal;
}

RCT_EXPORT_MODULE()

- (instancetype)init {
  self = [super init];
  if (self) {
    _queue = dispatch_queue_create("com.whipbridge.metrics", DISPATCH_QUEUE_SERIAL);
    _requestTimestamps = [NSMutableArray new];
    _latencies          = [NSMutableDictionary new];
    _totals             = [NSMutableDictionary new];
    _errors             = [NSMutableDictionary new];
    _droppedTotal       = 0;
  }
  return self;
}

RCT_EXPORT_METHOD(recordRequest:(NSString *)capability
                  latencyMs:(double)latencyMs
                  ok:(BOOL)ok)
{
  dispatch_async(_queue, ^{
    double nowMs = [[NSDate date] timeIntervalSince1970] * 1000.0;

    // Append timestamp; trim entries older than 5 seconds
    [self->_requestTimestamps addObject:@(nowMs)];
    while (self->_requestTimestamps.count > 0) {
      double oldest = [self->_requestTimestamps.firstObject doubleValue];
      if (nowMs - oldest > 5000.0) {
        [self->_requestTimestamps removeObjectAtIndex:0];
      } else {
        break;
      }
    }

    // Latency ring buffer per capability
    NSMutableArray<NSNumber *> *lats = self->_latencies[capability];
    if (!lats) {
      lats = [NSMutableArray new];
      self->_latencies[capability] = lats;
    }
    [lats addObject:@(latencyMs)];
    if (lats.count > kMaxSamples) {
      [lats removeObjectAtIndex:0];
    }

    // Counters
    self->_totals[capability] = @([self->_totals[capability] integerValue] + 1);
    if (!ok) {
      self->_errors[capability] = @([self->_errors[capability] integerValue] + 1);
    }
  });
}

RCT_EXPORT_METHOD(recordDropped:(NSString *)reason)
{
  dispatch_async(_queue, ^{
    self->_droppedTotal++;
  });
}

RCT_REMAP_METHOD(getSnapshot,
                 getSnapshotWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(_queue, ^{
    double nowMs = [[NSDate date] timeIntervalSince1970] * 1000.0;

    // req/sec — count timestamps in the last 1000 ms
    NSInteger recentCount = 0;
    for (NSNumber *ts in self->_requestTimestamps) {
      if (nowMs - [ts doubleValue] <= 1000.0) {
        recentCount++;
      }
    }

    // p50 / p99 per capability
    NSMutableDictionary *p50Map = [NSMutableDictionary new];
    NSMutableDictionary *p99Map = [NSMutableDictionary new];
    [self->_latencies enumerateKeysAndObjectsUsingBlock:^(NSString *cap,
                                                           NSMutableArray<NSNumber *> *lats,
                                                           BOOL *stop) {
      if (lats.count == 0) { return; }
      NSArray<NSNumber *> *sorted = [lats sortedArrayUsingComparator:^NSComparisonResult(NSNumber *a, NSNumber *b) {
        return [a compare:b];
      }];
      NSUInteger n   = sorted.count;
      NSUInteger i50 = n / 2;
      NSUInteger i99 = (NSUInteger)(n * 0.99);
      p50Map[cap] = sorted[MIN(i50, n - 1)];
      p99Map[cap] = sorted[MIN(i99, n - 1)];
    }];

    // Overall error rate
    NSInteger totalReqs = 0, totalErrors = 0;
    for (NSNumber *v in self->_totals.allValues) { totalReqs  += v.integerValue; }
    for (NSNumber *v in self->_errors.allValues) { totalErrors += v.integerValue; }
    double errorRate = totalReqs > 0 ? (double)totalErrors / totalReqs : 0.0;

    resolve(@{
      @"reqPerSec":          @(recentCount),
      @"p50ByCapability":    p50Map,
      @"p99ByCapability":    p99Map,
      @"errorRate":          @(errorRate),
      @"droppedTotal":       @(self->_droppedTotal),
    });
  });
}

@end
