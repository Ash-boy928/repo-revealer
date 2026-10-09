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

/** Shows the bot's own dashboard (http://127.0.0.1:3000) inside the app. */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val url = "http://127.0.0.1:${BotService.PORT}/"
    private val handler = Handler(Looper.getMainLooper())

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

        var retries = 0
        val maxRetries = 40 // 40 seconds max wait for first boot

        web.webViewClient = object : WebViewClient() {
            override fun onReceivedError(v: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) {
                    retries++
                    val html = """
                        <!DOCTYPE html>
                        <html>
                        <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
                        <body style="background:#0b0f19;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;text-align:center">
                          <div style="width:48px;height:48px;border:3px solid #334155;border-top-color:#38bdf8;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:20px"></div>
                          <h2 style="font-size:20px;font-weight:600;margin:0 0 8px 0;color:#f8fafc">Starting LeoTeleBot Engine</h2>
                          <p style="font-size:14px;color:#94a3b8;margin:0 0 16px 0">Starting local server on device... (${'$'}retries s)</p>
                          ${if (retries > 15) """<button onclick="location.reload()" style="background:#0284c7;color:white;border:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">Retry Now</button>""" else ""}
                          <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
                        </body>
                        </html>
                    """.trimIndent()
                    v.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
                    handler.postDelayed({ v.loadUrl(url) }, 1000)
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
        web.loadUrl(url)
        
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true) // keep bot running
    }
}
