package com.leotelebot.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** Shows the bot's dashboard (http://127.0.0.1:3000) or logs if booting/errored. */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val botUrl = "http://127.0.0.1:${BotService.PORT}/"
    private val handler = Handler(Looper.getMainLooper())
    private var isConnected = false
    private var pollCount = 0

    @SuppressLint("SetJavaScriptEnabled", "BatteryLife")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            try {
                startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            } catch (_: Exception) {}
        }

        BotService.start(this)

        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.databaseEnabled = true
        web.settings.useWideViewPort = true
        web.settings.loadWithOverviewMode = true

        web.webViewClient = object : WebViewClient() {
            override fun onReceivedError(v: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame && !isConnected) {
                    showStatusPage()
                }
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url != null && (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost"))) {
                    isConnected = true
                }
            }
            override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.host == "127.0.0.1" || u.host == "localhost") return false
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) {}
                return true
            }
        }

        setContentView(web)
        showStatusPage()
        startServerPoller()
    }

    private fun readBootLog(): String {
        return try {
            val logFile = File(filesDir, "leo/boot.log")
            if (logFile.exists()) logFile.readText().takeLast(3000) else "Waiting for Node process to write boot logs..."
        } catch (e: Exception) {
            "Error reading log: ${e.message}"
        }
    }

    private fun showStatusPage() {
        if (isConnected) return
        val logs = readBootLog()
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")

        val html = """
            <!DOCTYPE html>
            <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <style>
                body { background: #0b0f19; color: #f8fafc; font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 20px; }
                .spinner { width: 36px; height: 36px; border: 3px solid #334155; border-top-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px auto; }
                h2 { font-size: 18px; margin: 0 0 6px 0; text-align: center; }
                p { font-size: 13px; color: #94a3b8; text-align: center; margin: 0 0 16px 0; }
                .console { background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 11px; color: #38bdf8; white-space: pre-wrap; word-break: break-all; max-height: 50vh; overflow-y: auto; }
                .btn { display: block; width: 100%; box-sizing: border-box; background: #0284c7; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 16px; cursor: pointer; text-align: center; }
                @keyframes spin { to { transform: rotate(360deg); } }
              </style>
            </head>
            <body>
              <div class="spinner"></div>
              <h2>Starting LeoTeleBot Engine</h2>
              <p>Initializing local engine on this device... ($pollCount s)</p>
              <div class="console">$logs</div>
              <button class="btn" onclick="location.reload()">Refresh Status</button>
            </body>
            </html>
        """.trimIndent()

        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    private fun startServerPoller() {
        thread {
            while (!isConnected && !isFinishing) {
                pollCount += 2
                var serverUp = false
                try {
                    val conn = URL(botUrl).openConnection() as HttpURLConnection
                    conn.connectTimeout = 1200
                    conn.readTimeout = 1200
                    conn.requestMethod = "GET"
                    val code = conn.responseCode
                    if (code in 200..399) {
                        serverUp = true
                    }
                    conn.disconnect()
                } catch (_: Exception) {}

                handler.post {
                    if (serverUp && !isConnected) {
                        isConnected = true
                        web.loadUrl(botUrl)
                    } else if (!isConnected) {
                        showStatusPage()
                    }
                }
                Thread.sleep(2000)
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }
}
