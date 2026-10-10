package com.leotelebot.mobile

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

class BotService : Service() {

    companion object {
        const val CHANNEL = "leo_bot"
        const val PORT = 3000
        @Volatile var started = false
        @Volatile var extractStatus = "Preparing engine..."

        fun start(ctx: Context) {
            val i = Intent(ctx, BotService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        init {
            System.loadLibrary("node")
            System.loadLibrary("native-lib")
        }
    }

    private external fun startNodeWithArguments(args: Array<String>, env: Array<String>): Int

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground()
        if (!started) {
            started = true
            wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LeoTeleBot::bot").apply { acquire() }

            Thread({
                try {
                    val botDir = prepareBundle()
                    val dataDir = File(filesDir, "leo").apply { mkdirs() }
                    
                    extractStatus = "Starting Node server..."
                    Log.i("LeoTeleBot", "Launching Node from ${botDir.absolutePath}")

                    val code = startNodeWithArguments(
                        arrayOf("node", File(botDir, "main.mjs").absolutePath),
                        arrayOf(
                            "LEO_MOBILE=1",
                            "LEO_DATA_DIR=${dataDir.absolutePath}",
                            "PORT=$PORT",
                            "HOME=${filesDir.absolutePath}",
                            "TMPDIR=${cacheDir.absolutePath}"
                        )
                    )
                    Log.e("LeoTeleBot", "Node exited with code: $code")
                } catch (e: Exception) {
                    Log.e("LeoTeleBot", "Fatal error in BotService", e)
                    extractStatus = "Error: ${e.message}"
                } finally {
                    stopSelf()
                    android.os.Process.killProcess(android.os.Process.myPid())
                }
            }, "node-main").apply { start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    private fun prepareBundle(): File {
        val dir = File(filesDir, "nodebot")
        val stamp = File(dir, ".apk_version")
        val ver = packageManager.getPackageInfo(packageName, 0).lastUpdateTime.toString()
        if (stamp.exists() && stamp.readText() == ver && File(dir, "main.mjs").exists()) {
            extractStatus = "Bundle ready (cached)"
            return dir
        }

        extractStatus = "Extracting bot files (first time setup)..."
        dir.deleteRecursively()
        dir.mkdirs()

        assets.open("nodebot.zip").use { rawIn ->
            ZipInputStream(rawIn).use { zip ->
                var e = zip.nextEntry
                var count = 0
                val buffer = ByteArray(8192)
                while (e != null) {
                    val out = File(dir, e.name)
                    if (!out.canonicalPath.startsWith(dir.canonicalPath)) {
                        throw SecurityException("Invalid zip path entry")
                    }
                    if (e.isDirectory) {
                        out.mkdirs()
                    } else {
                        out.parentFile?.mkdirs()
                        FileOutputStream(out).use { fos ->
                            var len: Int
                            while (zip.read(buffer).also { len = it } > 0) {
                                fos.write(buffer, 0, len)
                            }
                        }
                    }
                    count++
                    if (count % 100 == 0) {
                        extractStatus = "Extracted $count files..."
                    }
                    e = zip.nextEntry
                }
            }
        }
        stamp.writeText(ver)
        extractStatus = "Extraction completed"
        return dir
    }

    private fun goForeground() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Bot engine", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this))
            .setContentTitle("LeoTeleBot running")
            .setContentText("Bot engine active on phone")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else startForeground(1, n)
    }
}
