package com.whipbridge.modules

import com.facebook.react.bridge.*
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong

class WhipMetricsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "WhipMetrics"

  private val maxSamples = 500

  // Wall-clock timestamps (ms) of recent requests — used for req/sec
  private val requestTimestamps = CopyOnWriteArrayList<Long>()

  // Per-capability latency ring buffers
  private val latencies = ConcurrentHashMap<String, MutableList<Double>>()
  private val totals    = ConcurrentHashMap<String, AtomicLong>()
  private val errors    = ConcurrentHashMap<String, AtomicLong>()

  private val droppedTotal = AtomicLong(0)

  @ReactMethod
  fun recordRequest(capability: String, latencyMs: Double, ok: Boolean) {
    val nowMs = System.currentTimeMillis()

    requestTimestamps.add(nowMs)
    // Trim entries older than 5 seconds
    requestTimestamps.removeIf { nowMs - it > 5_000L }

    // Latency ring buffer per capability
    val lats = latencies.getOrPut(capability) {
      Collections.synchronizedList(mutableListOf())
    }
    synchronized(lats) {
      lats.add(latencyMs)
      if (lats.size > maxSamples) { lats.removeAt(0) }
    }

    totals.getOrPut(capability) { AtomicLong(0) }.incrementAndGet()
    if (!ok) { errors.getOrPut(capability) { AtomicLong(0) }.incrementAndGet() }
  }

  @ReactMethod
  fun recordDropped(reason: String) {
    droppedTotal.incrementAndGet()
  }

  @ReactMethod
  fun getSnapshot(promise: Promise) {
    val nowMs = System.currentTimeMillis()

    // req/sec — count timestamps in the last 1000 ms
    val recentCount = requestTimestamps.count { nowMs - it <= 1_000L }

    // p50 / p99 per capability
    val p50Map = WritableNativeMap()
    val p99Map = WritableNativeMap()
    for ((cap, lats) in latencies) {
      val sorted = synchronized(lats) { lats.toList() }.sorted()
      if (sorted.isEmpty()) continue
      val i50 = sorted.size / 2
      val i99 = (sorted.size * 0.99).toInt().coerceAtMost(sorted.size - 1)
      p50Map.putDouble(cap, sorted[i50])
      p99Map.putDouble(cap, sorted[i99])
    }

    // Overall error rate
    val totalReqs   = totals.values.sumOf { it.get() }
    val totalErrors = errors.values.sumOf { it.get() }
    val errorRate   = if (totalReqs > 0) totalErrors.toDouble() / totalReqs else 0.0

    val result = WritableNativeMap().apply {
      putInt("reqPerSec",       recentCount)
      putMap("p50ByCapability", p50Map)
      putMap("p99ByCapability", p99Map)
      putDouble("errorRate",    errorRate)
      putDouble("droppedTotal", droppedTotal.get().toDouble())
    }
    promise.resolve(result)
  }
}
