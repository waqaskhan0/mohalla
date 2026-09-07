package org.shehersaaz.mohalla.core.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Whether the device currently has a validated internet connection (§16 · §43).
 *
 * WHY VALIDATED AND NOT MERELY CONNECTED. `NET_CAPABILITY_VALIDATED` is the
 * platform's own answer to "did a probe actually reach the internet", and the
 * difference matters here more than in most markets: a captive portal on shared
 * public Wi-Fi, or a mobile connection with an exhausted balance, both report a
 * live network that carries nothing. Treating those as online means the offline
 * banner never appears on exactly the connections where a user most needs to be
 * told why nothing is loading.
 *
 * THIS IS A HINT, NEVER A GATE. Nothing in the app decides whether to make a
 * request based on this flow. A request is attempted and its own failure is
 * authoritative — [ApiFailure.Offline] comes from an `IOException`, not from
 * here. The reason is that this signal is racy by nature: it can say "online"
 * while the request that started a millisecond ago is already failing, and it
 * can say "offline" when the request would have succeeded against a cache or a
 * local network. Using it as a gate turns an unreliable signal into a refusal
 * the user cannot retry past; using it as a banner tells them what is probably
 * wrong and costs nothing when it is mistaken.
 */
class ConnectivityObserver(context: Context) {

    private val manager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    /** The value to render before any callback has fired. */
    fun isOnlineNow(): Boolean {
        val active = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(active) ?: return false
        return caps.isUsableForApi()
    }

    /**
     * Emits on every transition.
     *
     * `callbackFlow` so the platform callback is unregistered when the collector
     * goes away — a leaked `NetworkCallback` outlives the composition and keeps
     * a `ConnectivityManager` reference alive for the process's lifetime, which
     * on a 2GB device (NFR-COMP-002) is not free.
     */
    fun isOnline(): Flow<Boolean> = callbackFlow {
        trySend(isOnlineNow())

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // NOT sent as `true`. Availability precedes validation, so a
                // captive portal fires this before the probe fails. The
                // capabilities callback below is what decides.
                trySend(isOnlineNow())
            }

            override fun onLost(network: Network) {
                trySend(isOnlineNow())
            }

            override fun onCapabilitiesChanged(
                network: Network,
                capabilities: NetworkCapabilities,
            ) {
                trySend(capabilities.isUsableForApi())
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        manager.registerNetworkCallback(request, callback)

        awaitClose { manager.unregisterNetworkCallback(callback) }
    }.distinctUntilChanged()
}

private fun NetworkCapabilities.isUsableForApi(): Boolean =
    hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
