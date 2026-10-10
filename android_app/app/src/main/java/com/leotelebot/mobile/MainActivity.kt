package com.leotelebot.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val botUrl = "http://127.0.0.1:${BotService.PORT}/"
    private val handler = Handler(Looper.getMainLooper())
    private var isConnected = false
    private var secondsPassed = 0

    @SuppressLint("SetJavaScriptEnabled", "BatteryLife")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val rootLayout = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#0b0f19"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0b0f19"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true

            webViewClient = object : WebViewClient() {
                override fun onReceivedError(v: WebView, req: WebResourceRequest, err: WebResourceError) {
                    if (req.isForMainFrame && !isConnected) {
                        renderStatusUi()
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
        }

        rootLayout.addView(web)
        setContentView(rootLayout)

        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            try {
                startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            } catch (_: Exception) {}
        }

        BotService.start(this)
        renderStatusUi()
        startServerPoller()
    }

    private fun readBootLog(): String {
        return try {
            val logFile = File(filesDir, "leo/boot.log")
            if (logFile.exists()) {
                val txt = logFile.readText()
                if (txt.isNotBlank()) txt.takeLast(4000) else "Log file created, waiting for output..."
            } else {
                "Engine status: ${BotService.extractStatus}\nWaiting for process to start..."
            }
        } catch (e: Exception) {
            "Status: ${BotService.extractStatus}\nLog read notice: ${e.message}"
        }
    }

    private fun renderStatusUi() {
        if (isConnected) return
        val rawLogs = readBootLog()
        val safeLogs = rawLogs
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")

        val html = """
            <!DOCTYPE html>
            <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
              <style>
                * { box-sizing: border-box; }
                body { background: #0b0f19; color: #f8fafc; font-family: -apple-system, Roboto, sans-serif; margin: 0; padding: 20px; display: flex; flex-direction: column; min-height: 100vh; }
                .spinner { width: 42px; height: 42px; border: 4px solid #1e293b; border-top-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite; margin: 16px auto; }
                h2 { font-size: 20px; font-weight: 700; margin: 0 0 6px 0; text-align: center; color: #ffffff; }
                p.sub { font-size: 13px; color: #94a3b8; text-align: center; margin: 0 0 16px 0; }
                .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 12px; margin-bottom: 14px; }
                .badge { display: inline-block; padding: 4px 10px; background: #0369a1; border-radius: 6px; font-size: 12px; font-weight: 600; color: #e0f2fe; margin-bottom: 8px; }
                .console { background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 11px; color: #38bdf8; white-space: pre-wrap; word-break: break-all; max-height: 50vh; overflow-y: auto; }
                .btn { display: block; width: 100%; background: #0284c7; color: white; border: none; padding: 13px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; text-align: center; }
                @keyframes spin { to { transform: rotate(360deg); } }
              </style>
            </head>
            <body>
              <div class="spinner"></div>
              <h2>LeoTeleBot Engine</h2>
              <p class="sub">Active on device resources &bull; (${secondsPassed}s)</p>
              
              <div class="card">
                <span class="badge">${BotService.extractStatus}</span>
                <div class="console">$safeLogs</div>
              </div>
              <button class="btn" onclick="location.reload()">Refresh Console</button>
            </body>
            </html>
        """.trimIndent()

        web.loadDataWithBaseURL("http://127.0.0.1/", html, "text/html", "utf-8", null)
    }

    private fun startServerPoller() {
        thread {
            while (!isConnected && !isFinishing) {
                secondsPassed += 2
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
                        renderStatusUi()
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
