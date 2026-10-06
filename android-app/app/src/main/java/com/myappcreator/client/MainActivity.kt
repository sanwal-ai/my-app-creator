package com.myappcreator.client

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query

class MainActivity : AppCompatActivity() {

    private val firebaseApp by lazy {
        FirebaseApp.getApps(this).firstOrNull()
            ?: FirebaseApp.initializeApp(
                this,
                FirebaseOptions.Builder()
                    .setApplicationId(AppBuildConfig.FIREBASE_APPLICATION_ID)
                    .setApiKey(AppBuildConfig.FIREBASE_API_KEY)
                    .setProjectId(AppBuildConfig.FIREBASE_PROJECT_ID)
                    .build()
            )!!
    }

    private val db by lazy { FirebaseFirestore.getInstance(firebaseApp) }
    private val appDocumentId by lazy { AppBuildConfig.APP_DOCUMENT_ID }

    private lateinit var webView: WebView
    private lateinit var loading: ProgressBar
    private lateinit var errorText: TextView

    private var appListener: ListenerRegistration? = null
    private var sectionsListener: ListenerRegistration? = null
    private var appData: Map<String, Any?> = emptyMap()
    private var sectionsData: List<Map<String, Any?>> = emptyList()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this)

        webView = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
            addJavascriptInterface(AppBridge(), "Android")
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                loadsImagesAutomatically = true
                mediaPlaybackRequiresUserGesture = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }
        }

        loading = ProgressBar(this)

        errorText = TextView(this).apply {
            textSize = 16f
            setPadding(40, 40, 40, 40)
            visibility = View.GONE
        }

        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        root.addView(
            loading,
            FrameLayout.LayoutParams(-2, -2).apply {
                gravity = android.view.Gravity.CENTER
            }
        )
        root.addView(
            errorText,
            FrameLayout.LayoutParams(-1, -2).apply {
                gravity = android.view.Gravity.CENTER
            }
        )

        setContentView(root)
        listenToFirebase()
    }

    private inner class AppBridge {
        @android.webkit.JavascriptInterface
        fun openUrl(rawUrl: String) {
            val safe = url(rawUrl)
            if (safe.isBlank()) return
            runOnUiThread {
                webView.loadUrl(safe)
            }
        }
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    private fun listenToFirebase() {
        loading.visibility = View.VISIBLE

        appListener = db.collection("apps")
            .document(appDocumentId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    showError("App load failed: ${error.message}")
                    return@addSnapshotListener
                }
                if (snapshot == null || !snapshot.exists()) {
                    showError("App document not found.")
                    return@addSnapshotListener
                }
                appData = snapshot.data ?: emptyMap()
                render()
            }

        sectionsListener = db.collection("apps")
            .document(appDocumentId)
            .collection("sections")
            .orderBy("createdAt", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    showError("Sections load failed: ${error.message}")
                    return@addSnapshotListener
                }

                sectionsData = snapshot?.documents?.map { doc ->
                    val item = doc.data?.toMutableMap() ?: mutableMapOf()
                    item["documentId"] = doc.id
                    item
                }?.filter { it["enabled"] != false } ?: emptyList()

                render()
            }
    }

    private fun render() {
        if (appData.isEmpty()) return

        loading.visibility = View.GONE
        errorText.visibility = View.GONE
        webView.visibility = View.VISIBLE

        webView.loadDataWithBaseURL(
            "https://app.local/",
            buildHtml(),
            "text/html",
            "UTF-8",
            null
        )
    }

    private fun buildHtml(): String {
        val appName = str(appData["name"], "My App")
        val version = str(appData["version"], "1.0.0")
        val design = obj(appData["design"])

        val primary = color(str(design["primaryColor"], str(appData["primaryColor"], "#5b5ce2")))
        val gradient = color(str(design["gradientColor"], "#8b5cf6"))
        val background = color(str(design["backgroundColor"], "#f5f6fa"))
        val textColor = color(str(design["textColor"], "#20212a"))
        val dark = str(design["appearance"], "light") == "dark"
        val headerStyle = str(design["headerStyle"], "classic")
        val navStyle = str(design["navigationStyle"], "bottom")
        val cardStyle = str(design["cardStyle"], "rounded")
        val gradientEnabled = bool(design["headerGradient"])
        val gradientDirection = gradientDirection(str(design["gradientDirection"], "135deg"))
        val font = font(str(design["fontFamily"], "Arial, sans-serif"))
        val iconUrl = url(str(design["iconUrl"], ""))
        val navLabels = design["navLabels"] != false
        val navRounded = design["navRounded"] != false

        val screenBg = if (dark) "#17181d" else background
        val screenText = if (dark) "#f4f4f6" else textColor
        val cardBg = if (dark) "#24252c" else "#ffffff"
        val muted = if (dark) "#b7b8c1" else "#777777"
        val divider = if (dark) "#343640" else "#eeeeee"

        val radius = when (cardStyle) {
            "square" -> "4px"
            "soft" -> "12px"
            "pill" -> "30px"
            else -> "20px"
        }

        val shadow = when (str(design["cardShadow"], "soft")) {
            "none" -> "none"
            "strong" -> "0 10px 28px rgba(0,0,0,.20)"
            else -> "0 3px 14px rgba(0,0,0,.08)"
        }

        val border = when (str(design["cardBorder"], "none")) {
            "accent" -> "1px solid $primary"
            "thin" -> "1px solid rgba(120,120,130,.20)"
            else -> "none"
        }

        val headerBg = if (gradientEnabled)
            "linear-gradient($gradientDirection,$primary,$gradient)"
        else primary

        val enabledSections = sectionsData
        val cards = if (enabledSections.isEmpty()) {
            """<div class="empty"><div>📱</div><h3>No enabled sections</h3><p>Builder se section add ya enable karein.</p></div>"""
        } else {
            enabledSections.joinToString("\n") { renderSection(it, primary) }
        }

        val navItems = enabledSections.take(5).joinToString("") {
            """<a href="#${attr(str(it["documentId"]))}">${html(str(it["name"], "Section"))}</a>"""
        }

        val topNav = if (navStyle == "top" || navStyle == "tabs" || navStyle == "menu") {
            """<nav class="topnav"><a href="#top">Home</a>$navItems${if (navStyle == "menu") "<span>☰ Menu</span>" else ""}</nav>"""
        } else ""

        val sideNav = if (navStyle == "left" || navStyle == "right") {
            """<aside class="sidenav ${if (navStyle == "right") "right" else "left"}"><b>☰ Menu</b><a href="#top">⌂ Home</a>$navItems</aside>"""
        } else ""

        val bottomNav = if (navStyle == "bottom") {
            val homeLabel = if (navLabels) "<small>Home</small>" else ""
            val secLabel = if (navLabels) "<small>Sections</small>" else ""
            val aboutLabel = if (navLabels) "<small>About</small>" else ""
            """<nav class="bottomnav ${if (navRounded) "rounded" else ""}">
                <a href="#top">⌂$homeLabel</a>
                <a href="#content">▦$secLabel</a>
                <a href="#about">ⓘ$aboutLabel</a>
            </nav>"""
        } else ""

        val icon = if (headerStyle == "minimal") "" else if (iconUrl.isNotBlank()) {
            """<img class="appicon" src="${attr(iconUrl)}" alt="">"""
        } else {
            """<div class="appicon fallback">${html(appName.take(1).uppercase())}</div>"""
        }

        return """
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:$screenBg;color:$screenText;font-family:$font;min-height:100vh}
a{color:inherit}
.header{position:sticky;top:0;z-index:20;background:$headerBg;color:#fff;padding:17px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 3px 14px rgba(0,0,0,.12)}
.header.centered{justify-content:center;flex-direction:column;text-align:center}
.header.minimal{padding:19px 17px}
.appicon{width:48px;height:48px;border-radius:13px;object-fit:cover;background:rgba(255,255,255,.20)}
.appicon.fallback{display:grid;place-items:center;font-size:20px;font-weight:800}
.title{font-size:20px;font-weight:800}.version{font-size:11px;opacity:.8;margin-top:2px}
.page{padding:12px 12px ${if (navStyle == "bottom") "82px" else "24px"}}
.card{background:$cardBg;border-radius:$radius;box-shadow:$shadow;border:$border;margin-bottom:12px;overflow:hidden}
.cardhead{padding:11px 13px;border-bottom:1px solid $divider;font-weight:800;display:flex;justify-content:space-between;gap:8px}
.cardhead small{font-size:10px;font-weight:500;opacity:.55}
.body{padding:13px}.body h3{margin:0 0 8px}.muted{color:$muted;font-size:12px;line-height:1.5}.copy{font-size:13px;line-height:1.6;white-space:pre-wrap}
.image{width:100%;max-height:300px;object-fit:cover;border-radius:10px;margin-bottom:9px}
.cover{width:110px;height:110px;object-fit:cover;border-radius:12px;margin-bottom:9px}
.logoimg{width:80px;height:80px;object-fit:cover;border-radius:18px;margin-bottom:9px}
.btn{display:inline-block;border:0;border-radius:9px;padding:9px 13px;background:$primary;color:#fff;text-decoration:none;font-weight:700;margin-top:7px}
.url{padding:9px;border-radius:8px;background:rgba(120,120,130,.10);font-size:11px;word-break:break-all}
video,audio{width:100%;margin-top:7px}
.gallery{display:grid;gap:8px}.gallery.grid{grid-template-columns:repeat(2,1fr)}.gallery.list{grid-template-columns:1fr}.gallery.slider{display:flex;overflow:auto}
.galleryitem{border:1px solid rgba(120,120,130,.16);border-radius:10px;overflow:hidden;min-width:140px}
.galleryitem img{width:100%;height:110px;object-fit:cover;display:block}.galleryitem strong,.galleryitem span{display:block;padding:6px 8px;font-size:11px}.galleryitem span{padding-top:0;color:$muted}
.line{padding:8px 0;border-bottom:1px solid $divider;font-size:12px;word-break:break-word}
.htmlframe{width:100%;height:280px;border:0;background:#fff;border-radius:9px}
.foldergrid,.tvgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.tvgrid.list{grid-template-columns:1fr}
.folderstack{display:grid;gap:9px}.folder,.channel{padding:11px;border:1px solid rgba(120,120,130,.16);border-radius:12px}
.folder summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none}.folder summary::-webkit-details-marker{display:none}
.folder img,.channel img{width:52px;height:52px;object-fit:contain;border-radius:10px}.foldericon{font-size:30px}
.folder strong,.channel strong,.channel small{display:block}.folder small,.channel small{color:$muted;margin-top:3px}
.folderchildren{display:grid;gap:8px;padding-top:10px}.childrow{display:flex;align-items:center;gap:8px;padding:8px;border-radius:9px;background:rgba(120,120,130,.08)}
.childrow img{width:38px;height:38px;object-fit:cover;border-radius:8px}.childinfo{flex:1;min-width:0}.childinfo strong,.childinfo small{display:block}.childinfo small{color:$muted;font-size:10px}.miniicon{font-size:18px}
.topnav{position:sticky;top:82px;z-index:18;display:flex;gap:7px;overflow:auto;padding:9px 10px;background:$cardBg;border-bottom:1px solid $divider}
.topnav a,.topnav span,.sidenav a{white-space:nowrap;text-decoration:none;padding:7px 9px;border-radius:8px;background:rgba(120,120,130,.12);font-size:10px}
.sidenav{position:fixed;top:0;bottom:0;width:108px;background:$cardBg;z-index:30;padding:14px 7px;display:flex;flex-direction:column;gap:7px;overflow:auto;box-shadow:0 0 20px rgba(0,0,0,.12)}
.sidenav.left{left:0}.sidenav.right{right:0}.sidenav b{padding:7px}
body:has(.sidenav.left) .shell{margin-left:108px}body:has(.sidenav.right) .shell{margin-right:108px}
.bottomnav{position:fixed;left:0;right:0;bottom:0;z-index:40;background:$cardBg;border-top:1px solid $divider;display:flex;justify-content:space-around;padding:9px 6px}
.bottomnav.rounded{left:10px;right:10px;bottom:8px;border-radius:18px;box-shadow:0 4px 20px rgba(0,0,0,.16)}
.bottomnav a{text-decoration:none;text-align:center;font-size:18px}.bottomnav small{display:block;font-size:9px;margin-top:2px}
.empty{text-align:center;padding:70px 20px;color:$muted}.empty div{font-size:42px}
@media(max-width:380px){.gallery.grid,.foldergrid,.tvgrid{grid-template-columns:1fr}}
</style>
</head>
<body id="top">
$sideNav
<div class="shell">
<header class="header ${if (headerStyle == "centered") "centered" else ""} ${if (headerStyle == "minimal") "minimal" else ""}">
$icon
<div><div class="title">${html(appName)}</div>${if (headerStyle == "minimal") "" else """<div class="version">Version ${html(version)}</div>"""}</div>
</header>
$topNav
<main class="page" id="content">$cards<div id="about"></div></main>
</div>
$bottomNav
</body>
</html>
""".trimIndent()
    }

    private fun renderSection(section: Map<String, Any?>, primary: String): String {
        val id = attr(str(section["documentId"]))
        val name = str(section["name"], "Section")
        val type = str(section["type"], "Text")
        val c = obj(section["content"])

        val body = when (type) {
            "Text" -> """
                ${heading(str(c["title"]))}
                ${p(str(c["subtitle"]), "muted")}
                ${p(str(c["body"]), "copy")}
                ${button(str(c["buttonText"]), url(str(c["buttonUrl"])))}
            """

            "Image" -> """
                ${image(url(str(c["imageUrl"])), "image")}
                ${heading(str(c["title"]))}
                ${p(str(c["caption"]), "muted")}
                ${p(str(c["description"]), "copy")}
                ${button(str(c["buttonText"]), url(str(c["buttonUrl"])))}
            """

            "Website" -> {
                val website = url(str(c["url"]))
                """
                ${heading(str(c["title"]))}
                ${p(str(c["description"]), "copy")}
                ${if (website.isNotBlank()) """<div class="url">${html(website)}</div><button class="btn" onclick="Android.openUrl('${js(website)}')">Open Website</button>""" else ""}
                """
            }

            "Video" -> {
                val video = url(str(c["videoUrl"]))
                val thumb = url(str(c["thumbnailUrl"]))
                """
                ${heading(str(c["title"]))}
                ${if (video.isNotBlank()) """<video controls preload="metadata" ${if (thumb.isNotBlank()) """poster="${attr(thumb)}"""" else ""}><source src="${attr(video)}"></video>""" else """<p class="muted">Video URL add karein.</p>"""}
                ${p(str(c["description"]), "copy")}
            """
            }

            "Audio" -> {
                val audio = url(str(c["audioUrl"]))
                """
                ${image(url(str(c["coverUrl"])), "cover")}
                ${heading(str(c["title"]))}
                ${p(str(c["artist"]), "muted")}
                ${if (audio.isNotBlank()) """<audio controls preload="metadata"><source src="${attr(audio)}"></audio>""" else """<p class="muted">Audio URL add karein.</p>"""}
                ${p(str(c["description"]), "copy")}
            """
            }

            "Gallery" -> {
                val layout = str(c["layout"], "grid")
                val items = list(c["items"]).joinToString("") { raw ->
                    val item = obj(raw)
                    val link = url(str(item["link"]))
                    """<div class="galleryitem">
                        ${image(url(str(item["imageUrl"])), "")}
                        <strong>${html(str(item["title"]))}</strong>
                        <span>${html(str(item["description"]))}</span>
                        ${if (link.isNotBlank()) """<button class="btn" onclick="Android.openUrl('${js(link)}')">Open</button>""" else ""}
                    </div>"""
                }
                """${heading(str(c["title"]))}${p(str(c["description"]), "muted")}<div class="gallery ${attr(layout)}">$items</div>"""
            }

            "Contact" -> """
                ${heading(str(c["title"]))}
                ${p(str(c["description"]), "copy")}
                ${line("📞", str(c["phone"]))}
                ${line("✉", str(c["email"]))}
                ${line("📍", str(c["address"]))}
                ${websiteLine(str(c["website"]))}
            """

            "About" -> """
                ${image(url(str(c["logoUrl"])), "logoimg")}
                ${heading(str(c["title"]))}
                ${p(str(c["description"]), "copy")}
                ${websiteLine(str(c["website"]))}
                ${line("✉", str(c["email"]))}
            """

            "HTML" -> {
                val src = """<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${safeCss(str(c["css"]))}</style></head><body>${safeBuilderHtml(str(c["html"]))}</body></html>"""
                """${heading(str(c["title"]))}<iframe class="htmlframe" sandbox="" srcdoc="${attr(src)}"></iframe>"""
            }

            "Game" -> {
                val game = url(str(c["gameUrl"]))
                """
                ${image(url(str(c["thumbnailUrl"])), "image")}
                ${heading(str(c["title"]))}
                ${p(str(c["description"]), "copy")}
                ${if (game.isNotBlank()) """<button class="btn" onclick="Android.openUrl('${js(game)}')">Play Game</button>""" else ""}
                """
            }

            "Folder" -> renderFolder(c)

            "Live TV" -> renderTv(c)

            else -> """<p class="muted">Unsupported section type.</p>"""
        }

        return """<section class="card" id="$id"><div class="cardhead"><span>${html(name)}</span><small>${html(type)}</small></div><div class="body">$body</div></section>"""
    }

    private fun renderFolder(c: Map<String, Any?>): String {
        val items = list(c["items"]).map { obj(it) }
        val roots = items.filter { str(it["parentId"]).isBlank() }

        fun targetButton(item: Map<String, Any?>): String {
            val target = url(str(item["targetUrl"]))
            if (target.isBlank()) return ""
            val type = str(item["targetType"], "Website")
            val label = when (type) {
                "Video" -> "Watch Video"
                "Live TV" -> "Watch"
                "Game" -> "Play Game"
                else -> "Open"
            }
            return """<button class="btn" onclick="Android.openUrl('${js(target)}')">${html(label)}</button>"""
        }

        val cards = roots.joinToString("") { folder ->
            val folderId = str(folder["id"])
            val children = items.filter { str(it["parentId"]) == folderId }
            val childrenHtml = children.joinToString("") { child ->
                val icon = url(str(child["iconUrl"]))
                """<div class="childrow">
                    ${if (icon.isNotBlank()) """<img src="${attr(icon)}" alt="">""" else """<span class="miniicon">↳</span>"""}
                    <div class="childinfo"><strong>${html(str(child["name"], "Item"))}</strong><small>${html(str(child["targetType"], "Folder"))}</small></div>
                    ${targetButton(child)}
                </div>"""
            }

            """<details class="folder">
                <summary>
                    ${if (url(str(folder["iconUrl"])).isNotBlank()) image(url(str(folder["iconUrl"])), "") else """<div class="foldericon">📁</div>"""}
                    <div><strong>${html(str(folder["name"], "Folder"))}</strong><small>${children.size} items</small></div>
                </summary>
                <div class="folderchildren">
                    $childrenHtml
                    ${targetButton(folder)}
                    ${if (children.isEmpty() && url(str(folder["targetUrl"])).isBlank()) """<div class="muted">Folder empty hai.</div>""" else ""}
                </div>
            </details>"""
        }

        return """${heading(str(c["title"]))}${p(str(c["description"]), "muted")}<div class="folderstack">$cards</div>${if (roots.isEmpty()) """<p class="muted">No folders yet.</p>""" else ""}"""
    }

    private fun renderTv(c: Map<String, Any?>): String {
        val layout = str(c["layout"], "grid")
        val channels = list(c["channels"]).joinToString("") { raw ->
            val channel = obj(raw)
            val stream = url(str(channel["streamUrl"]))
            val logo = url(str(channel["logoUrl"]))

            """<div class="channel">
                ${if (logo.isNotBlank()) image(logo, "") else """<div class="foldericon">📺</div>"""}
                <strong>${html(str(channel["name"], "Channel"))}</strong>
                ${if (str(channel["category"]).isNotBlank()) """<small>${html(str(channel["category"]))}</small>""" else ""}
                ${p(str(channel["description"]), "muted")}
                ${if (stream.isNotBlank()) """<button class="btn" onclick="Android.openUrl('${js(stream)}')">Watch</button>""" else ""}
            </div>"""
        }

        return """${heading(str(c["title"], "Live TV"))}${p(str(c["description"]), "muted")}<div class="tvgrid ${if (layout == "list") "list" else ""}">$channels</div>"""
    }

    private fun heading(v: String) =
        if (v.isBlank()) "" else "<h3>${html(v)}</h3>"

    private fun p(v: String, cls: String) =
        if (v.isBlank()) "" else """<p class="$cls">${html(v)}</p>"""

    private fun image(v: String, cls: String) =
        if (v.isBlank()) "" else """<img class="${attr(cls)}" src="${attr(v)}" alt="">"""

    private fun button(label: String, link: String) =
        if (label.isBlank() || link.isBlank()) "" else """<a class="btn" href="${attr(link)}">${html(label)}</a>"""

    private fun line(icon: String, value: String) =
        if (value.isBlank()) "" else """<div class="line">$icon ${html(value)}</div>"""

    private fun websiteLine(value: String): String {
        val link = url(value)
        return if (link.isBlank()) "" else """<div class="line">🌐 <a href="${attr(link)}">${html(link)}</a></div>"""
    }

    private fun str(value: Any?, fallback: String = "") =
        value?.toString()?.takeIf { it != "null" } ?: fallback

    @Suppress("UNCHECKED_CAST")
    private fun obj(value: Any?): Map<String, Any?> =
        value as? Map<String, Any?> ?: emptyMap()

    @Suppress("UNCHECKED_CAST")
    private fun list(value: Any?): List<Any?> =
        value as? List<Any?> ?: emptyList()

    private fun bool(value: Any?) =
        value == true || value?.toString()?.equals("true", true) == true

    private fun url(value: String): String {
        val v = value.trim()
        return if (v.startsWith("https://", true) || v.startsWith("http://", true)) v else ""
    }

    private fun color(value: String): String {
        val v = value.trim()
        return if (Regex("^#[0-9a-fA-F]{3,8}$").matches(v)) v else "#5b5ce2"
    }

    private fun gradientDirection(value: String) =
        if (Regex("^(45|90|135|180)deg$").matches(value)) value else "135deg"

    private fun font(value: String) =
        value.replace(Regex("[^a-zA-Z0-9 ,.'\"_-]"), "").take(100).ifBlank { "Arial, sans-serif" }

    private fun html(value: String) =
        value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#39;")

    private fun attr(value: String) = html(value)

    private fun js(value: String) =
        value.replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\r", "")
            .replace("\n", "\\n")

    private fun safeCss(value: String) =
        value.replace("</style", "<\\/style", ignoreCase = true)

    private fun safeBuilderHtml(value: String) =
        value.replace(Regex("(?is)<script.*?>.*?</script>"), "")
            .replace(Regex("(?i)\\son\\w+\\s*=\\s*(['\"]).*?\\1"), "")
            .replace(Regex("(?i)javascript:"), "")

    private fun showError(message: String) {
        loading.visibility = View.GONE
        webView.visibility = View.GONE
        errorText.visibility = View.VISIBLE
        errorText.text = message
    }

    override fun onDestroy() {
        appListener?.remove()
        sectionsListener?.remove()
        webView.destroy()
        super.onDestroy()
    }
}
