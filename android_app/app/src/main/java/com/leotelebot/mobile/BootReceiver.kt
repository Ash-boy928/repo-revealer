package com.leotelebot.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restarts the bot after phone reboot or app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        BotService.start(ctx)
    }
}
