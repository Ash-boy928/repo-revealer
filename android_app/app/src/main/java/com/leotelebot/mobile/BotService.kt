package com.leotelebot.mobile

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import java.io.File
import java.util.zip.ZipInputStream

/**
 * Foreground service: keeps the UNCHANGED bot (node main.mjs) running 24/7
 * on the phone's own CPU, RAM, storage and internet.
 */
class BotService : Service() {

    companion object {
        const val CHANNEL = "leo_bot"
        const val PORT = 3000
        @Volatile var started = false

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
                val botDir = prepareBundle()
                val dataDir = File(filesDir, "leo").apply { mkdirs() }
                val code = startNodeWithArguments(
                    arrayOf("node", File(botDir, "main.mjs").absolutePath),
                    arrayOf(
                        "LEO_MOBILE=1",
                        "LEO_DATA_DIR=${dataDir.absolutePath}",
                        "PORT=$PORT",
                        "HOME=${filesDir.absolutePath}",
                        "TMPDIR=${cacheDir.absolutePath}",
                    ),
                )
                // Node can only start once per process: exit so Android restarts us (START_STICKY)
                android.util.Log.e("LeoTeleBot", "node exited with $code")
                stopSelf()
                android.os.Process.killProcess(android.os.Process.myPid())
            }, "node-main").apply { start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    /** Unzips assets/nodebot.zip into filesDir/nodebot when the app version changes. */
    private fun prepareBundle(): File {
        val dir = File(filesDir, "nodebot")
        val stamp = File(dir, ".apk_version")
        val ver = packageManager.getPackageInfo(packageName, 0).lastUpdateTime.toString()
        if (stamp.exists() && stamp.readText() == ver) return dir
        dir.deleteRecursively()
        dir.mkdirs()
        ZipInputStream(assets.open("nodebot.zip")).use { zip ->
            var e = zip.nextEntry
            while (e != null) {
                val out = File(dir, e.name)
                if (!out.canonicalPath.startsWith(dir.canonicalPath)) throw SecurityException("bad zip entry")
                if (e.isDirectory) out.mkdirs() else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { zip.copyTo(it) }
                }
                e = zip.nextEntry
            }
        }
        stamp.writeText(ver)
        return dir
    }

    private fun goForeground() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Bot engine", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this))
            .setContentTitle("LeoTeleBot running")
            .setContentText("Bot engine active on this phone")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else startForeground(1, n)
    }
}
