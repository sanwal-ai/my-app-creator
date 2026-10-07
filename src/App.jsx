import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import "./index.css";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { app, db } from "./firebase";

const auth = getAuth(app);
const BUILD_API_URL = "https://myappcreator-api.snwlmobile.workers.dev/build";

function App() {
  const [apps, setApps] = useState([]);
  const [selectedApp, setSelectedApp] = useState(null);
  const [view, setView] = useState("home");

  const [sections, setSections] = useState([]);
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sectionType, setSectionType] = useState("Text");

  const [editingSection, setEditingSection] = useState(null);
  const [sectionContent, setSectionContent] = useState({});
  const [contentSaving, setContentSaving] = useState(false);
  const [designSaving, setDesignSaving] = useState(false);
  const [designDraft, setDesignDraft] = useState({});

  const [loadingApps, setLoadingApps] = useState(false);
  const [saving, setSaving] = useState(false);

  const [adminUser, setAdminUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [buildingApk, setBuildingApk] = useState(false);
  const [buildMessage, setBuildMessage] = useState("");
  const [buildStatus, setBuildStatus] = useState("");
  const [buildRunId, setBuildRunId] = useState("");
  const [downloadingApk, setDownloadingApk] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAdminUser(user);
      setAuthLoading(false);
      if (user) {
        await loadApps();
      } else {
        setApps([]);
        setSelectedApp(null);
        setSections([]);
        setView("home");
      }
    });
    return unsubscribe;
  }, []);

  const loadApps = async () => {
    try {
      setLoadingApps(true);

      const appsQuery = query(
        collection(db, "apps"),
        orderBy("createdAt", "desc")
      );

      const snapshot = await getDocs(appsQuery);

      const loadedApps = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));

      setApps(loadedApps);
    } catch (error) {
      console.error("Error loading apps:", error);
      alert(
        "Apps load nahi ho sakin. Firebase Firestore connection aur rules check karein."
      );
    } finally {
      setLoadingApps(false);
    }
  };

  // Load sections belonging to one app.
  const loadSections = async (appId) => {
    try {
      const sectionsQuery = query(
        collection(db, "apps", String(appId), "sections"),
        orderBy("createdAt", "asc")
      );

      const snapshot = await getDocs(sectionsQuery);

      const loadedSections = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));

      setSections(loadedSections);
    } catch (error) {
      console.error("Error loading sections:", error);
      setSections([]);
      alert(
        "Sections load nahi ho sakin. Firestore connection aur rules check karein."
      );
    }
  };


  const handleAdminLogin = async (event) => {
    event.preventDefault();
    setLoginError("");
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("Email aur password enter karein.");
      return;
    }
    try {
      setLoginLoading(true);
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setLoginPassword("");
    } catch (error) {
      console.error("Admin login error:", error);
      setLoginError("Login failed. Email ya password check karein.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
      alert("Logout nahi ho saka.");
    }
  };

  const waitForApkBuild = async (appId) => {
    const maxChecks = 90;

    for (let attempt = 0; attempt < maxChecks; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 8000));

      const user = auth.currentUser;
      if (!user) throw new Error("Firebase login required");

      const idToken = await user.getIdToken();
      const response = await fetch(
        `${BUILD_API_URL.replace("/build", "/status")}?app_id=${encodeURIComponent(appId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );

      let result = {};
      try { result = await response.json(); } catch {}

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `Build status check failed (${response.status})`);
      }

      if (!result.found || result.status === "queued") {
        setBuildStatus("queued");
        setBuildMessage("APK build queue mein hai...");
        continue;
      }

      if (result.status === "building") {
        setBuildStatus("building");
        setBuildMessage("APK build ho rahi hai... GitHub Actions ka wait karein.");
        continue;
      }

      if (result.status === "failed") {
        setBuildStatus("failed");
        setBuildingApk(false);
        setBuildMessage("APK build fail ho gayi. GitHub Actions mein error check karein.");
        return;
      }

      if (result.status === "success") {
        if (!result.artifact_available) {
          setBuildStatus("building");
          setBuildMessage("Build complete hai, APK artifact prepare ho raha hai...");
          continue;
        }

        setBuildRunId(String(result.run_id || ""));
        setBuildStatus("success");
        setBuildingApk(false);
        setBuildMessage("Build Complete ✅ APK download ke liye ready hai.");
        return;
      }
    }

    setBuildingApk(false);
    setBuildStatus("timeout");
    setBuildMessage("Build abhi complete nahi hui. Thori dair baad dobara status check karein.");
  };

  const buildApk = async () => {
    if (!selectedApp || !auth.currentUser || buildingApk) return;

    const appName = String(selectedApp.name || "").trim();
    const packageName = String(selectedApp.packageName || "").trim();
    const versionName = String(selectedApp.version || "1.0.0").trim();
    const versionCode = String(selectedApp.versionCode || "1").trim();

    if (!appName) {
      setBuildMessage("App Name required hai.");
      return;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
      setBuildMessage("Valid Android Package Name enter karein.");
      return;
    }
    if (!/^[0-9]+(\.[0-9A-Za-z_-]+)*$/.test(versionName)) {
      setBuildMessage("Valid Version enter karein, example 1.0.0");
      return;
    }

    try {
      setBuildingApk(true);
      setBuildRunId("");
      setBuildStatus("starting");
      setBuildMessage("APK build start ki ja rahi hai...");
      const idToken = await auth.currentUser.getIdToken(true);

      const response = await fetch(BUILD_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          app_id: String(selectedApp.id),
          app_name: appName,
          package_name: packageName,
          version_name: versionName,
          version_code: versionCode,
          icon_url: String(selectedApp.design?.iconUrl || "").trim(),
        }),
      });

      let result = {};
      try { result = await response.json(); } catch {}

      if (!response.ok || !result.ok) {
        throw new Error(result.error || result.details || `Build request failed (${response.status})`);
      }

      setBuildStatus("queued");
      setBuildMessage("Build start ho gayi ✅ Status automatically check ho raha hai...");
      await waitForApkBuild(String(selectedApp.id));
    } catch (error) {
      console.error("APK build error:", error);
      setBuildingApk(false);
      setBuildStatus("failed");
      setBuildMessage(`Build error: ${error.message}`);
    }
  };

  const downloadApk = async () => {
    if (!buildRunId || !auth.currentUser || downloadingApk) return;

    try {
      setDownloadingApk(true);
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch(
        `${BUILD_API_URL.replace("/build", "/download")}?run_id=${encodeURIComponent(buildRunId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );

      const contentType = response.headers.get("Content-Type") || "";

      if (contentType.includes("application/json")) {
        const result = await response.json();
        if (!response.ok || !result.ok || !result.download_url) {
          throw new Error(result.error || `Download failed (${response.status})`);
        }
        window.location.href = result.download_url;
      } else {
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `${String(selectedApp?.name || "app").replace(/[^a-zA-Z0-9._-]+/g, "-")}-APK.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (error) {
      console.error("APK download error:", error);
      setBuildMessage(`APK download nahi hui: ${error.message}`);
    } finally {
      setDownloadingApk(false);
    }
  };

  const createApp = async () => {
    const appId = String(Date.now());

    const newApp = {
      id: appId,
      name: "My New App",
      description: "My first Android application",
      version: "1.0.0",
      packageName: `com.myapp.app${Date.now()}`,
      primaryColor: "#5b5ce2",
      status: "Draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      setSaving(true);

      await setDoc(doc(db, "apps", appId), newApp);

      setApps((currentApps) => [newApp, ...currentApps]);
      setSelectedApp(newApp);
      setSections([]);
      setView("settings");
    } catch (error) {
      console.error("Error creating app:", error);
      alert(
        "App save nahi hui. Firebase Firestore connection aur rules check karein."
      );
    } finally {
      setSaving(false);
    }
  };

  const openApp = async (app) => {
    setSelectedApp(app);
    setView("settings");
    await loadSections(app.id);
  };


  const getDesign = (app = selectedApp) => ({
    iconUrl: app?.design?.iconUrl || "",
    primaryColor: app?.design?.primaryColor || app?.primaryColor || "#5b5ce2",
    backgroundColor: app?.design?.backgroundColor || "#f5f6fa",
    textColor: app?.design?.textColor || "#20212a",
    appearance: app?.design?.appearance || "light",
    headerStyle: app?.design?.headerStyle || "classic",
    navigationStyle: app?.design?.navigationStyle || "bottom",
    cardStyle: app?.design?.cardStyle || "rounded",
    headerGradient: app?.design?.headerGradient || false,
    gradientColor: app?.design?.gradientColor || "#8b5cf6",
    gradientDirection: app?.design?.gradientDirection || "135deg",
    fontFamily: app?.design?.fontFamily || "Arial, sans-serif",
    cardShadow: app?.design?.cardShadow || "soft",
    cardBorder: app?.design?.cardBorder || "none",
    navLabels: app?.design?.navLabels ?? true,
    navRounded: app?.design?.navRounded ?? true,
  });

  const openDesign = () => {
    if (!selectedApp) return;
    setDesignDraft(getDesign(selectedApp));
    setView("design");
  };

  const updateDesignField = (field, value) => {
    setDesignDraft((current) => ({ ...current, [field]: value }));
  };

  const saveDesign = async () => {
    if (!selectedApp) return;

    try {
      setDesignSaving(true);
      const design = { ...getDesign(selectedApp), ...designDraft };
      const updatedAt = Date.now();

      await setDoc(
        doc(db, "apps", String(selectedApp.id)),
        { design, primaryColor: design.primaryColor, updatedAt },
        { merge: true }
      );

      const updatedApp = {
        ...selectedApp,
        design,
        primaryColor: design.primaryColor,
        updatedAt,
      };

      setSelectedApp(updatedApp);
      setApps((current) =>
        current.map((app) => app.id === updatedApp.id ? updatedApp : app)
      );
      setDesignDraft(design);
      alert("App design successfully save ho gaya.");
    } catch (error) {
      console.error("Error saving app design:", error);
      alert("Design Firebase mein save nahi hua.");
    } finally {
      setDesignSaving(false);
    }
  };

  const updateApp = async (field, value) => {
    if (!selectedApp) return;

    const updatedApp = {
      ...selectedApp,
      [field]: value,
      updatedAt: Date.now(),
    };

    setSelectedApp(updatedApp);

    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === updatedApp.id ? updatedApp : app
      )
    );

    try {
      await setDoc(
        doc(db, "apps", String(updatedApp.id)),
        {
          [field]: value,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("Error updating app:", error);
      alert("App setting Firebase mein save nahi hui.");
    }
  };

  const goHome = () => {
    setSelectedApp(null);
    setSections([]);
    setView("home");
  };

  const getDefaultContent = (type) => {
    const defaults = {
      Text: { title: "", subtitle: "", body: "", buttonText: "", buttonUrl: "" },
      Image: { title: "", imageUrl: "", caption: "", description: "", buttonText: "", buttonUrl: "" },
      Website: { title: "", url: "", description: "", openMode: "in-app" },
      Video: { title: "", videoUrl: "", thumbnailUrl: "", description: "" },
      Audio: { title: "", audioUrl: "", coverUrl: "", artist: "", description: "" },
      Gallery: { title: "", description: "", layout: "grid", items: [] },
      Contact: { title: "", description: "", phone: "", email: "", address: "", website: "" },
      About: { title: "", description: "", logoUrl: "", website: "", email: "" },
      HTML: { title: "", html: "<div><h2>Welcome</h2><p>Your content goes here.</p></div>", css: "" },
      Game: { title: "", description: "", thumbnailUrl: "", gameUrl: "", gameType: "HTML Game" },
      Folder: { title: "", description: "", items: [] },
      "Live TV": { title: "", description: "", layout: "grid", channels: [] },
    };
    return defaults[type] || {};
  };

  const addSection = async () => {
    if (!sectionName.trim() || !selectedApp) return;

    const sectionId = String(Date.now());
    const now = Date.now();

    const newSection = {
      id: sectionId,
      name: sectionName.trim(),
      type: sectionType,
      enabled: true,
      content: getDefaultContent(sectionType),
      createdAt: now,
      updatedAt: now,
    };

    try {
      setSaving(true);

      await setDoc(
        doc(db, "apps", String(selectedApp.id), "sections", sectionId),
        newSection
      );

      setSections((current) => [...current, newSection]);
      setSectionName("");
      setSectionType("Text");
      setShowSectionForm(false);

      setEditingSection(newSection);
      setSectionContent(newSection.content);
    } catch (error) {
      console.error("Error adding section:", error);
      alert("Section Firebase mein save nahi hua.");
    } finally {
      setSaving(false);
    }
  };

  const openSectionEditor = (section) => {
    setEditingSection(section);
    setSectionContent(section.content || getDefaultContent(section.type));
  };

  const updateSectionContentField = (field, value) => {
    setSectionContent((current) => ({ ...current, [field]: value }));
  };

  const saveSectionContent = async () => {
    if (!selectedApp || !editingSection) return;

    try {
      setContentSaving(true);
      const updatedAt = Date.now();

      await setDoc(
        doc(db, "apps", String(selectedApp.id), "sections", String(editingSection.id)),
        { content: sectionContent, updatedAt },
        { merge: true }
      );

      setSections((current) =>
        current.map((section) =>
          section.id === editingSection.id
            ? { ...section, content: sectionContent, updatedAt }
            : section
        )
      );

      setEditingSection((current) =>
        current ? { ...current, content: sectionContent, updatedAt } : current
      );

      alert("Section content successfully save ho gaya.");
    } catch (error) {
      console.error("Error saving section content:", error);
      alert("Section content Firebase mein save nahi hua.");
    } finally {
      setContentSaving(false);
    }
  };

  const addGalleryItem = () => {
    setSectionContent((current) => ({
      ...current,
      items: [
        ...(current.items || []),
        { id: String(Date.now()), imageUrl: "", title: "", description: "", link: "" },
      ],
    }));
  };

  const updateGalleryItem = (id, field, value) => {
    setSectionContent((current) => ({
      ...current,
      items: (current.items || []).map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    }));
  };

  const removeGalleryItem = (id) => {
    setSectionContent((current) => ({
      ...current,
      items: (current.items || []).filter((item) => item.id !== id),
    }));
  };

  const contentField = (label, field, placeholder, multiline = false) => (
    <div className="content-field">
      <label>{label}</label>
      {multiline ? (
        <textarea
          rows="5"
          value={sectionContent[field] || ""}
          onChange={(e) => updateSectionContentField(field, e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          value={sectionContent[field] || ""}
          onChange={(e) => updateSectionContentField(field, e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );


  const addFolderItem = (parentId = "") => {
    const item = { id: String(Date.now()), parentId, name: "", iconUrl: "", targetType: "Folder", targetUrl: "" };
    setSectionContent((current) => ({ ...current, items: [...(current.items || []), item] }));
  };

  const updateFolderItem = (id, field, value) => {
    setSectionContent((current) => ({
      ...current,
      items: (current.items || []).map((item) => item.id === id ? { ...item, [field]: value } : item),
    }));
  };

  const removeFolderItem = (id) => {
    setSectionContent((current) => ({
      ...current,
      items: (current.items || []).filter((item) => item.id !== id && item.parentId !== id),
    }));
  };

  const addTvChannel = () => {
    const channel = { id: String(Date.now()), name: "", logoUrl: "", streamUrl: "", category: "", description: "" };
    setSectionContent((current) => ({ ...current, channels: [...(current.channels || []), channel] }));
  };

  const updateTvChannel = (id, field, value) => {
    setSectionContent((current) => ({
      ...current,
      channels: (current.channels || []).map((item) => item.id === id ? { ...item, [field]: value } : item),
    }));
  };

  const removeTvChannel = (id) => {
    setSectionContent((current) => ({
      ...current,
      channels: (current.channels || []).filter((item) => item.id !== id),
    }));
  };

  const renderSectionContentEditor = () => {
    if (!editingSection) return null;

    const type = editingSection.type;

    return (
      <div className="content-editor-card">
        <div className="content-editor-header">
          <div>
            <p className="small dark">SECTION CONTENT</p>
            <h2>{editingSection.name}</h2>
            <p>{type} section editor</p>
          </div>
          <button
            className="cancel-btn"
            onClick={() => setEditingSection(null)}
            disabled={contentSaving}
          >
            ← Back to Sections
          </button>
        </div>

        <div className="content-editor-body">
          {type === "Text" && <>
            {contentField("Title", "title", "Section title")}
            {contentField("Subtitle", "subtitle", "Optional subtitle")}
            {contentField("Content", "body", "Write your text here...", true)}
            {contentField("Button Text", "buttonText", "Read More")}
            {contentField("Button URL", "buttonUrl", "https://example.com")}
          </>}

          {type === "Image" && <>
            {contentField("Image URL", "imageUrl", "https://.../image.jpg")}
            {contentField("Title", "title", "Image title")}
            {contentField("Caption", "caption", "Short caption")}
            {contentField("Description", "description", "Image description...", true)}
            {contentField("Button Text", "buttonText", "Open")}
            {contentField("Button URL", "buttonUrl", "https://...")}
            {sectionContent.imageUrl && (
              <div className="content-preview">
                <img src={sectionContent.imageUrl} alt={sectionContent.title || "Preview"} />
              </div>
            )}
          </>}

          {type === "Website" && <>
            {contentField("Page Title", "title", "Website title")}
            {contentField("Website URL", "url", "https://example.com")}
            {contentField("Description", "description", "Describe this website...", true)}
            <div className="content-field">
              <label>Open Mode</label>
              <select
                value={sectionContent.openMode || "in-app"}
                onChange={(e) => updateSectionContentField("openMode", e.target.value)}
              >
                <option value="in-app">Open inside app</option>
                <option value="external">Open external browser</option>
              </select>
            </div>
          </>}

          {type === "Video" && <>
            {contentField("Video Title", "title", "Video title")}
            {contentField("Video URL", "videoUrl", "https://...")}
            {contentField("Thumbnail URL", "thumbnailUrl", "https://.../thumbnail.jpg")}
            {contentField("Description", "description", "Video description...", true)}
          </>}

          {type === "Audio" && <>
            {contentField("Audio Title", "title", "Audio title")}
            {contentField("Audio URL", "audioUrl", "https://.../audio.mp3")}
            {contentField("Cover Image URL", "coverUrl", "https://.../cover.jpg")}
            {contentField("Artist", "artist", "Artist name")}
            {contentField("Description", "description", "Audio description...", true)}
          </>}

          {type === "Gallery" && <>
            {contentField("Gallery Title", "title", "Gallery title")}
            {contentField("Description", "description", "Gallery description...", true)}
            <div className="content-field">
              <label>Gallery Layout</label>
              <select
                value={sectionContent.layout || "grid"}
                onChange={(e) => updateSectionContentField("layout", e.target.value)}
              >
                <option value="grid">Grid</option>
                <option value="list">List</option>
                <option value="slider">Slider</option>
              </select>
            </div>

            <div className="gallery-editor">
              <div className="gallery-editor-title">
                <h3>Gallery Images</h3>
                <button className="section-add-btn" onClick={addGalleryItem}>
                  + Add Image
                </button>
              </div>

              {(sectionContent.items || []).map((item, index) => (
                <div className="gallery-item-editor" key={item.id}>
                  <strong>{index + 1}</strong>
                  <div className="gallery-item-fields">
                    <input
                      value={item.imageUrl || ""}
                      onChange={(e) => updateGalleryItem(item.id, "imageUrl", e.target.value)}
                      placeholder="Image URL"
                    />
                    <input
                      value={item.title || ""}
                      onChange={(e) => updateGalleryItem(item.id, "title", e.target.value)}
                      placeholder="Image title"
                    />
                    <textarea
                      rows="3"
                      value={item.description || ""}
                      onChange={(e) => updateGalleryItem(item.id, "description", e.target.value)}
                      placeholder="Image description"
                    />
                    <input
                      value={item.link || ""}
                      onChange={(e) => updateGalleryItem(item.id, "link", e.target.value)}
                      placeholder="Optional click URL"
                    />
                  </div>
                  <button className="delete-section" onClick={() => removeGalleryItem(item.id)}>
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </>}

          {type === "Contact" && <>
            {contentField("Title", "title", "Contact us")}
            {contentField("Description", "description", "Contact description...", true)}
            {contentField("Phone", "phone", "+92...")}
            {contentField("Email", "email", "name@example.com")}
            {contentField("Address", "address", "Business address")}
            {contentField("Website", "website", "https://example.com")}
          </>}

          {type === "About" && <>
            {contentField("Title", "title", "About this app")}
            {contentField("Description", "description", "About content...", true)}
            {contentField("Logo URL", "logoUrl", "https://.../logo.png")}
            {contentField("Website", "website", "https://example.com")}
            {contentField("Email", "email", "name@example.com")}
          </>}

          {type === "HTML" && <>
            {contentField("Title", "title", "HTML section title")}
            {contentField("HTML", "html", "<div>...</div>", true)}
            {contentField("CSS", "css", "/* optional CSS */", true)}
            <div className="html-warning">
              <strong>HTML Preview:</strong> Content will be rendered in a controlled sandbox/WebView in the final app.
            </div>
            <div className="html-preview-box">
              <iframe
                title="HTML preview"
                sandbox=""
                srcDoc={`<style>${sectionContent.css || ""}</style>${sectionContent.html || ""}`}
              />
            </div>
          </>}


          {type === "Folder" && <>
            {contentField("Folder Section Title", "title", "Categories")}
            {contentField("Description", "description", "Folder section description...", true)}
            <div className="gallery-editor">
              <div className="gallery-editor-title">
                <h3>Folders & Sub Folders</h3>
                <button className="section-add-btn" onClick={() => addFolderItem("")}>+ Add Folder</button>
              </div>
              {(sectionContent.items || []).map((item, index) => (
                <div className="gallery-item-editor" key={item.id}>
                  <strong>{index + 1}</strong>
                  <div className="gallery-item-fields">
                    <input value={item.name || ""} onChange={(e) => updateFolderItem(item.id, "name", e.target.value)} placeholder="Folder / item name" />
                    <input value={item.iconUrl || ""} onChange={(e) => updateFolderItem(item.id, "iconUrl", e.target.value)} placeholder="Icon / image URL" />
                    <select value={item.parentId || ""} onChange={(e) => updateFolderItem(item.id, "parentId", e.target.value)}>
                      <option value="">Main Folder</option>
                      {(sectionContent.items || []).filter((f) => f.id !== item.id && !f.parentId).map((f) => <option key={f.id} value={f.id}>Inside: {f.name || "Unnamed Folder"}</option>)}
                    </select>
                    <select value={item.targetType || "Folder"} onChange={(e) => updateFolderItem(item.id, "targetType", e.target.value)}>
                      <option>Folder</option><option>Website</option><option>Video</option><option>Live TV</option><option>Game</option>
                    </select>
                    <input value={item.targetUrl || ""} onChange={(e) => updateFolderItem(item.id, "targetUrl", e.target.value)} placeholder="Optional content / target URL" />
                  </div>
                  <button className="delete-section" onClick={() => removeFolderItem(item.id)}>🗑</button>
                </div>
              ))}
              {!(sectionContent.items || []).length && <p className="card-description">Main folders add karein; kisi item ke “Inside” option se sub-folder ban jayega.</p>}
            </div>
          </>}

          {type === "Live TV" && <>
            {contentField("Live TV Title", "title", "Live TV")}
            {contentField("Description", "description", "Live channels description...", true)}
            <div className="content-field">
              <label>Channel Layout</label>
              <select value={sectionContent.layout || "grid"} onChange={(e) => updateSectionContentField("layout", e.target.value)}>
                <option value="grid">Grid</option><option value="list">List</option>
              </select>
            </div>
            <div className="gallery-editor">
              <div className="gallery-editor-title">
                <h3>TV Channels</h3>
                <button className="section-add-btn" onClick={addTvChannel}>+ Add Channel</button>
              </div>
              {(sectionContent.channels || []).map((channel, index) => (
                <div className="gallery-item-editor" key={channel.id}>
                  <strong>{index + 1}</strong>
                  <div className="gallery-item-fields">
                    <input value={channel.name || ""} onChange={(e) => updateTvChannel(channel.id, "name", e.target.value)} placeholder="Channel name" />
                    <input value={channel.logoUrl || ""} onChange={(e) => updateTvChannel(channel.id, "logoUrl", e.target.value)} placeholder="Channel logo URL" />
                    <input value={channel.streamUrl || ""} onChange={(e) => updateTvChannel(channel.id, "streamUrl", e.target.value)} placeholder="Legal stream / HLS / webpage URL" />
                    <input value={channel.category || ""} onChange={(e) => updateTvChannel(channel.id, "category", e.target.value)} placeholder="Category e.g. News, Sports" />
                    <textarea rows="2" value={channel.description || ""} onChange={(e) => updateTvChannel(channel.id, "description", e.target.value)} placeholder="Short description" />
                  </div>
                  <button className="delete-section" onClick={() => removeTvChannel(channel.id)}>🗑</button>
                </div>
              ))}
            </div>
          </>}

          {type === "Game" && <>
            {contentField("Game Title", "title", "Game name")}
            {contentField("Description", "description", "Game description...", true)}
            {contentField("Thumbnail URL", "thumbnailUrl", "https://.../game.jpg")}
            {contentField("Game URL", "gameUrl", "https://...")}
            <div className="content-field">
              <label>Game Type</label>
              <select
                value={sectionContent.gameType || "HTML Game"}
                onChange={(e) => updateSectionContentField("gameType", e.target.value)}
              >
                <option>HTML Game</option>
                <option>Web Game</option>
                <option>Game Page</option>
              </select>
            </div>
          </>}

          <div className="content-editor-actions">
            <button className="cancel-btn" onClick={() => setEditingSection(null)} disabled={contentSaving}>
              Cancel
            </button>
            <button className="save-section-btn" onClick={saveSectionContent} disabled={contentSaving}>
              {contentSaving ? "Saving..." : "Save Content"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const deleteSection = async (id) => {
    if (!selectedApp) return;

    try {
      setSaving(true);

      await deleteDoc(
        doc(
          db,
          "apps",
          String(selectedApp.id),
          "sections",
          String(id)
        )
      );

      setSections((currentSections) =>
        currentSections.filter((section) => section.id !== id)
      );
    } catch (error) {
      console.error("Error deleting section:", error);
      alert("Section delete nahi hua.");
    } finally {
      setSaving(false);
    }
  };

  const toggleSection = async (id) => {
    if (!selectedApp) return;

    const section = sections.find((item) => item.id === id);

    if (!section) return;

    const newEnabled = !section.enabled;

    setSections((currentSections) =>
      currentSections.map((item) =>
        item.id === id
          ? {
              ...item,
              enabled: newEnabled,
              updatedAt: Date.now(),
            }
          : item
      )
    );

    try {
      await setDoc(
        doc(
          db,
          "apps",
          String(selectedApp.id),
          "sections",
          String(id)
        ),
        {
          enabled: newEnabled,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("Error updating section:", error);

      // Reload from Firebase if the update fails.
      await loadSections(selectedApp.id);

      alert("Section status Firebase mein save nahi hua.");
    }
  };

  const renderPreviewContent = (section) => {
    const design = getDesign(selectedApp);
    const content = section.content || {};

    switch (section.type) {
      case "Text":
        return <div className="pv-body">{content.title && <h3>{content.title}</h3>}{content.subtitle && <p className="pv-muted">{content.subtitle}</p>}{content.body && <p className="pv-text">{content.body}</p>}{content.buttonText && <button className="pv-action" style={{ background: design?.primaryColor || "#5b5ce2" }}>{content.buttonText}</button>}</div>;
      case "Image":
        return <div className="pv-body">{content.imageUrl ? <img className="pv-image" src={content.imageUrl} alt={content.title || "Image"} /> : <div className="pv-empty">Image URL add karein</div>}{content.title && <h3>{content.title}</h3>}{content.caption && <p className="pv-muted">{content.caption}</p>}{content.description && <p className="pv-text">{content.description}</p>}</div>;
      case "Gallery":
        return <div className="pv-body">{content.title && <h3>{content.title}</h3>}{content.description && <p className="pv-muted">{content.description}</p>}<div className={`pv-gallery ${content.layout || "grid"}`}>{(content.items || []).map((item) => <div className="pv-gallery-item" key={item.id}>{item.imageUrl ? <img src={item.imageUrl} alt={item.title || "Gallery"} /> : <div className="pv-empty">No image</div>}{item.title && <strong>{item.title}</strong>}{item.description && <span>{item.description}</span>}</div>)}</div>{!(content.items || []).length && <div className="pv-empty">Gallery mein abhi images nahi hain</div>}</div>;
      case "Website":
        return <div className="pv-body">{content.title && <h3>{content.title}</h3>}{content.description && <p className="pv-text">{content.description}</p>}{content.url && <div className="pv-url">{content.url}</div>}<button className="pv-action" style={{ background: design?.primaryColor || "#5b5ce2" }}>Open Website</button></div>;
      case "Video":
        return <div className="pv-body">{content.title && <h3>{content.title}</h3>}{content.videoUrl ? <video className="pv-video" controls poster={content.thumbnailUrl || undefined}><source src={content.videoUrl} /></video> : <div className="pv-empty">Video URL add karein</div>}{content.description && <p className="pv-text">{content.description}</p>}</div>;
      case "Audio":
        return <div className="pv-body">{content.coverUrl && <img className="pv-cover" src={content.coverUrl} alt="Cover" />}{content.title && <h3>{content.title}</h3>}{content.artist && <p className="pv-muted">{content.artist}</p>}{content.audioUrl ? <audio className="pv-audio" controls><source src={content.audioUrl} /></audio> : <div className="pv-empty">Audio URL add karein</div>}{content.description && <p className="pv-text">{content.description}</p>}</div>;
      case "Contact":
        return <div className="pv-body">{content.title && <h3>{content.title}</h3>}{content.description && <p className="pv-text">{content.description}</p>}{content.phone && <div className="pv-line">📞 {content.phone}</div>}{content.email && <div className="pv-line">✉️ {content.email}</div>}{content.address && <div className="pv-line">📍 {content.address}</div>}{content.website && <div className="pv-line">🌐 {content.website}</div>}</div>;
      case "About":
        return <div className="pv-body">{content.logoUrl && <img className="pv-logo" src={content.logoUrl} alt="Logo" />}{content.title && <h3>{content.title}</h3>}{content.description && <p className="pv-text">{content.description}</p>}{content.website && <div className="pv-line">🌐 {content.website}</div>}{content.email && <div className="pv-line">✉️ {content.email}</div>}</div>;
      case "HTML":
        return <iframe className="pv-html" title={section.name} sandbox="" srcDoc={`<style>${content.css || ""}</style>${content.html || ""}`} />;
      case "Folder": {
        const roots = (content.items || []).filter((item) => !item.parentId);
        return <div className="pv-body">{content.title && <h3>{content.title}</h3>}{content.description && <p className="pv-muted">{content.description}</p>}<div className="pv-folder-grid">{roots.map((folder) => <div className="pv-folder" key={folder.id}>{folder.iconUrl ? <img src={folder.iconUrl} alt="" /> : <div className="pv-folder-icon">📁</div>}<strong>{folder.name || "Folder"}</strong><small>{(content.items || []).filter((x) => x.parentId === folder.id).length} items</small></div>)}</div>{!roots.length && <div className="pv-empty">No folders yet</div>}</div>;
      }
      case "Live TV":
        return <div className="pv-body">{content.title && <h3>{content.title}</h3>}{content.description && <p className="pv-muted">{content.description}</p>}<div className={`pv-tv ${content.layout || "grid"}`}>{(content.channels || []).map((channel) => <div className="pv-channel" key={channel.id}>{channel.logoUrl ? <img src={channel.logoUrl} alt="" /> : <div className="pv-channel-logo">TV</div>}<div><strong>{channel.name || "Channel"}</strong>{channel.category && <small>{channel.category}</small>}</div><button className="pv-action" style={{ background: design?.primaryColor || "#5b5ce2" }}>Watch</button></div>)}</div>{!(content.channels || []).length && <div className="pv-empty">No channels yet</div>}</div>;
      case "Game":
        return <div className="pv-body">{content.thumbnailUrl && <img className="pv-image" src={content.thumbnailUrl} alt={content.title || "Game"} />}{content.title && <h3>{content.title}</h3>}{content.description && <p className="pv-text">{content.description}</p>}{content.gameUrl && <button className="pv-action" style={{ background: design?.primaryColor || "#5b5ce2" }}>Play Game</button>}</div>;
      default:
        return <div className="pv-empty">Preview available nahi hai.</div>;
    }
  };


  if (authLoading) {
    return (
      <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f5f6fa",fontFamily:"Arial, sans-serif"}}>
        <div style={{background:"#fff",padding:"28px",borderRadius:"18px",boxShadow:"0 10px 35px rgba(20,20,40,.08)",textAlign:"center"}}>
          <h2 style={{margin:"0 0 8px"}}>My App Creator</h2>
          <p style={{margin:0,color:"#777"}}>Checking admin login...</p>
        </div>
      </div>
    );
  }

  if (!adminUser) {
    return (
      <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f5f6fa",padding:"20px",fontFamily:"Arial, sans-serif"}}>
        <form onSubmit={handleAdminLogin} style={{width:"100%",maxWidth:"420px",background:"#fff",padding:"28px",borderRadius:"20px",boxShadow:"0 14px 45px rgba(20,20,40,.10)",display:"grid",gap:"14px"}}>
          <div>
            <div style={{width:"52px",height:"52px",borderRadius:"15px",background:"#5b5ce2",color:"#fff",display:"grid",placeItems:"center",fontWeight:800,fontSize:"22px",marginBottom:"16px"}}>A</div>
            <h2 style={{margin:"0 0 6px"}}>Builder Admin Login</h2>
            <p style={{margin:0,color:"#777",lineHeight:1.5}}>Firebase Authentication wala admin account use karein.</p>
          </div>

          <label style={{fontWeight:700,fontSize:"14px"}}>Email</label>
          <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="Admin email" autoComplete="username"
            style={{boxSizing:"border-box",width:"100%",padding:"12px 13px",border:"1px solid #dfe1ea",borderRadius:"10px",font:"inherit"}} />

          <label style={{fontWeight:700,fontSize:"14px"}}>Password</label>
          <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Password" autoComplete="current-password"
            style={{boxSizing:"border-box",width:"100%",padding:"12px 13px",border:"1px solid #dfe1ea",borderRadius:"10px",font:"inherit"}} />

          {loginError && <div style={{padding:"11px 12px",borderRadius:"10px",background:"#fff1f1",color:"#b42318",fontSize:"13px"}}>{loginError}</div>}

          <button type="submit" disabled={loginLoading}
            style={{border:0,borderRadius:"10px",padding:"13px",background:"#5b5ce2",color:"#fff",fontWeight:800,cursor:"pointer"}}>
            {loginLoading ? "Signing in..." : "Login to Builder"}
          </button>
        </form>
      </div>
    );
  }

  /* =========================
     PREVIEW SCREEN
  ========================= */

  if (view === "preview" && selectedApp) {
    const enabledSections = sections.filter((section) => section.enabled);
    const design = getDesign(selectedApp);
    const dark = design.appearance === "dark";
    const screenBg = dark ? "#17181d" : design.backgroundColor;
    const screenText = dark ? "#f4f4f6" : design.textColor;
    const cardBg = dark ? "#24252c" : "#ffffff";
    const muted = dark ? "#b7b8c1" : "#777777";
    const divider = dark ? "#343640" : "#eeeeee";
    const cardRadius =
      design.cardStyle === "square" ? "4px" :
      design.cardStyle === "soft" ? "12px" :
      design.cardStyle === "pill" ? "30px" : "20px";
    const headerBackground = design.headerGradient ? `linear-gradient(${design.gradientDirection}, ${design.primaryColor}, ${design.gradientColor})` : design.primaryColor;
    const cardShadow = design.cardShadow === "none" ? "none" : design.cardShadow === "strong" ? "0 10px 28px rgba(0,0,0,.20)" : "0 3px 14px rgba(0,0,0,.08)";
    const cardBorder = design.cardBorder === "accent" ? `1px solid ${design.primaryColor}` : design.cardBorder === "thin" ? "1px solid rgba(120,120,130,.2)" : "none";

    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <button className="back-btn" onClick={() => setView("sections")}>←</button>
            <div><h1>{selectedApp.name}</h1><span>Live App Preview</span></div>
          </div>
          <button className="profile">S</button>
        </header>

        <main className="container">
          <style>{`
            .preview-page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px;flex-wrap:wrap}.preview-page-head h2{margin:0 0 5px}.preview-page-head p{margin:0;color:#777}.preview-refresh{border:0;border-radius:10px;padding:11px 15px;background:#eef0ff;color:#4b4cc9;font-weight:700;cursor:pointer}.preview-stage{display:flex;justify-content:center;padding:10px 0 30px}.phone-frame{width:390px;max-width:92vw;background:#15161b;border-radius:38px;padding:12px;box-shadow:0 22px 60px rgba(0,0,0,.25)}.phone-speaker{width:90px;height:19px;background:#08090c;border-radius:0 0 15px 15px;margin:-1px auto 6px}.phone-screen{height:720px;max-height:72vh;border-radius:27px;overflow:hidden;display:flex;flex-direction:column}.pv-appbar{color:white;padding:15px;display:flex;align-items:center;gap:11px}.pv-appbar.centered{justify-content:center;text-align:center;flex-direction:column}.pv-appbar.minimal{padding:17px 16px}.pv-app-icon{width:42px;height:42px;border-radius:12px;background:rgba(255,255,255,.2);display:grid;place-items:center;font-size:19px;font-weight:800;overflow:hidden}.pv-appbar strong,.pv-appbar span{display:block}.pv-appbar span{font-size:11px;opacity:.8;margin-top:2px}.pv-topnav{display:flex;gap:7px;padding:9px 10px;overflow:auto}.pv-topnav span{white-space:nowrap;padding:6px 9px;border-radius:8px;font-size:10px;background:rgba(120,120,130,.12)}.pv-scroll{flex:1;overflow:auto;padding:12px}.pv-section{margin-bottom:12px;overflow:hidden;box-shadow:0 2px 10px rgba(20,20,40,.05)}.pv-section-title{display:flex;justify-content:space-between;gap:10px;padding:11px 13px;border-bottom:1px solid;font-weight:800}.pv-section-title small{font-size:10px;font-weight:500;opacity:.55}.pv-body{padding:13px}.pv-body h3{margin:0 0 7px}.pv-muted{font-size:12px;margin:5px 0}.pv-text{font-size:13px;line-height:1.55;white-space:pre-wrap}.pv-image{width:100%;max-height:230px;object-fit:cover;border-radius:10px;margin-bottom:10px}.pv-action{border:0;border-radius:9px;padding:9px 13px;color:white;font-weight:700;margin-top:7px}.pv-empty{padding:24px 10px;border-radius:9px;text-align:center;font-size:12px;opacity:.75}.pv-url{padding:9px;border-radius:8px;font-size:11px;word-break:break-all}.pv-video,.pv-audio{width:100%}.pv-cover{width:110px;height:110px;object-fit:cover;border-radius:12px}.pv-logo{width:80px;height:80px;object-fit:cover;border-radius:18px}.pv-line{padding:8px 0;border-bottom:1px solid;font-size:12px}.pv-html{width:100%;height:260px;border:0;background:white}.pv-gallery{display:grid;gap:8px}.pv-gallery.grid{grid-template-columns:repeat(2,1fr)}.pv-gallery.list{grid-template-columns:1fr}.pv-gallery.slider{display:flex;overflow:auto}.pv-gallery-item{border-radius:9px;overflow:hidden;min-width:140px}.pv-gallery-item img{width:100%;height:105px;object-fit:cover;display:block}.pv-gallery-item strong,.pv-gallery-item span{display:block;padding:5px 7px;font-size:11px}.pv-gallery-item span{padding-top:0}.pv-folder-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.pv-folder{padding:12px;border:1px solid rgba(120,120,130,.16);border-radius:12px;display:grid;gap:5px}.pv-folder img{width:44px;height:44px;object-fit:cover;border-radius:10px}.pv-folder-icon{font-size:30px}.pv-folder small,.pv-channel small{opacity:.65}.pv-tv{display:grid;gap:9px}.pv-tv.grid{grid-template-columns:repeat(2,1fr)}.pv-tv.list{grid-template-columns:1fr}.pv-channel{padding:10px;border:1px solid rgba(120,120,130,.16);border-radius:12px;display:grid;gap:7px}.pv-channel img,.pv-channel-logo{width:52px;height:52px;object-fit:contain;border-radius:10px}.pv-channel-logo{display:grid;place-items:center;background:rgba(120,120,130,.12);font-weight:800}.pv-no-sections{text-align:center;padding:70px 20px;opacity:.7}.pv-no-sections div{font-size:42px}.pv-bottomnav{display:flex;justify-content:space-around;padding:11px 6px;border-top:1px solid;font-size:10px}.pv-bottomnav span{display:grid;gap:2px;text-align:center}.preview-note{max-width:620px;margin:0 auto 20px;padding:12px 15px;border-radius:12px;background:#fff9df;border:1px solid #eadfb5;font-size:13px;line-height:1.5}@media(max-width:520px){.phone-frame{width:100%}}
          `}</style>

          <div className="preview-page-head">
            <div><h2>Professional App Preview</h2><p>Saved Design + enabled sections mobile screen mein dikh rahe hain.</p></div>
            <button className="preview-refresh" onClick={() => loadSections(selectedApp.id)}>↻ Refresh Firebase Data</button>
          </div>

          <div className="preview-note">Design save karne ke baad Preview mein theme, icon, header, navigation aur card style apply honge.</div>

          <div className="preview-stage">
            <div className="phone-frame">
              <div className="phone-speaker"></div>
              <div className="phone-screen" style={{ background: screenBg, color: screenText, fontFamily: design.fontFamily }}>
                <div
                  className={`pv-appbar ${design.headerStyle === "centered" ? "centered" : ""} ${design.headerStyle === "minimal" ? "minimal" : ""}`}
                  style={{ background: headerBackground }}
                >
                  {design.headerStyle !== "minimal" && (
                    <div className="pv-app-icon">
                      {design.iconUrl ? (
                        <img src={design.iconUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />
                      ) : (
                        selectedApp.name?.charAt(0)?.toUpperCase() || "A"
                      )}
                    </div>
                  )}
                  <div>
                    <strong>{selectedApp.name}</strong>
                    {design.headerStyle !== "minimal" && <span>Version {selectedApp.version || "1.0.0"}</span>}
                  </div>
                </div>

                {(design.navigationStyle === "top" || design.navigationStyle === "tabs" || design.navigationStyle === "menu") && (
                  <div className="pv-topnav" style={{ background: cardBg, borderBottom:`1px solid ${divider}` }}>
                    <span>Home</span>
                    {enabledSections.slice(0, 4).map((section) => <span key={section.id}>{section.name}</span>)}
                    {design.navigationStyle === "menu" && <span>☰ Menu</span>}
                  </div>
                )}

                <div style={{display:"flex",flex:1,minHeight:0,flexDirection:design.navigationStyle === "right" ? "row-reverse" : "row"}}>
                  {(design.navigationStyle === "left" || design.navigationStyle === "right") && (
                    <div style={{width:"105px",background:cardBg,borderRight:design.navigationStyle === "left" ? `1px solid ${divider}` : "none",borderLeft:design.navigationStyle === "right" ? `1px solid ${divider}` : "none",padding:"10px 7px",display:"grid",alignContent:"start",gap:"7px",fontSize:"10px"}}>
                      <strong style={{padding:"6px"}}>☰ Menu</strong>
                      <span style={{padding:"7px"}}>⌂ Home</span>
                      {enabledSections.slice(0,5).map((section) => <span key={section.id} style={{padding:"7px",overflow:"hidden",textOverflow:"ellipsis"}}>{section.name}</span>)}
                    </div>
                  )}
                  <div className="pv-scroll">
                  {enabledSections.length === 0 ? (
                    <div className="pv-no-sections">
                      <div>📱</div><h3>No enabled sections</h3><p>Sections add ya enable karke preview refresh karein.</p>
                    </div>
                  ) : enabledSections.map((section) => (
                    <div
                      className="pv-section"
                      key={section.id}
                      style={{ background: design.cardStyle === "glass" ? (dark ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.65)") : cardBg, borderRadius: cardRadius, color: screenText, boxShadow: cardShadow, border: cardBorder }}
                    >
                      <div className="pv-section-title" style={{ borderColor: divider }}>
                        <span>{section.name}</span><small>{section.type}</small>
                      </div>
                      <div style={{"--pv-primary": design.primaryColor, "--pv-muted": muted}}>
                        {renderPreviewContent(section)}
                      </div>
                    </div>
                  ))}
                  </div>
                </div>

                {design.navigationStyle === "bottom" && (
                  <div className="pv-bottomnav" style={{ background: cardBg, borderColor: divider }}>
                    <span>⌂<small>Home</small></span>
                    <span>📄<small>Sections</small></span>
                    <span>ℹ<small>About</small></span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        <nav className="bottom-nav">
          <button onClick={goHome}><span>⌂</span>Home</button>
          <button onClick={() => setView("sections")}><span>📄</span>Sections</button>
          <button className="active"><span>👁</span>Preview</button>
          <button onClick={() => setView("settings")}><span>⚙</span>Settings</button>
        </nav>
      </div>
    );
  }

  /* =========================
     SECTIONS SCREEN
  ========================= */

  if (view === "sections" && selectedApp) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <button
              className="back-btn"
              onClick={() => setView("settings")}
            >
              ←
            </button>

            <div>
              <h1>{selectedApp.name}</h1>
              <span>Sections</span>
            </div>
          </div>

          <button className="profile">S</button>
        </header>

        <main className="container">

          <style>{`
            .content-editor-card{background:#fff;border:1px solid #e7e7ef;border-radius:18px;padding:22px;box-shadow:0 8px 28px rgba(20,20,40,.06);margin-bottom:24px}
            .content-editor-header{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:22px}
            .content-editor-header h2{margin:3px 0 4px}.content-editor-header p{margin:0}
            .content-editor-body{display:grid;gap:16px}.content-field{display:grid;gap:7px}
            .content-field label{font-weight:700;font-size:14px}
            .content-field input,.content-field textarea,.content-field select,.gallery-item-fields input,.gallery-item-fields textarea{width:100%;box-sizing:border-box;border:1px solid #dfe1ea;border-radius:10px;padding:12px 13px;font:inherit;background:#fff;outline:none}
            .content-field textarea,.gallery-item-fields textarea{resize:vertical;min-height:90px}
            .content-field input:focus,.content-field textarea:focus,.content-field select:focus,.gallery-item-fields input:focus,.gallery-item-fields textarea:focus{border-color:#5b5ce2;box-shadow:0 0 0 3px rgba(91,92,226,.10)}
            .content-preview{border:1px solid #e7e7ef;border-radius:14px;padding:10px;overflow:hidden}.content-preview img{display:block;max-width:100%;max-height:320px;margin:auto;border-radius:10px;object-fit:contain}
            .gallery-editor{border:1px solid #e7e7ef;border-radius:14px;padding:14px;display:grid;gap:12px}
            .gallery-editor-title{display:flex;justify-content:space-between;align-items:center;gap:12px}.gallery-editor-title h3{margin:0}
            .gallery-item-editor{display:grid;grid-template-columns:36px 1fr auto;gap:10px;align-items:start;padding:12px;background:#f8f8fb;border-radius:12px}
            .gallery-item-fields{display:grid;gap:8px}.content-editor-actions{display:flex;justify-content:flex-end;gap:10px;padding-top:8px}
            .edit-section-btn{border:0;border-radius:9px;padding:9px 13px;background:#eeeefe;color:#4b4cc9;font-weight:700;cursor:pointer}
            .html-warning{border:1px solid #eadfb5;background:#fff9df;border-radius:10px;padding:12px;font-size:13px;line-height:1.5}
            .html-preview-box{border:1px solid #e7e7ef;border-radius:12px;overflow:hidden;background:#fff}.html-preview-box iframe{width:100%;min-height:260px;border:0;display:block}
            @media(max-width:700px){.content-editor-header{align-items:flex-start;flex-direction:column}.gallery-item-editor{grid-template-columns:1fr}.content-editor-actions{flex-direction:column}.content-editor-actions button{width:100%}}
          `}</style>
          <div className="builder-header">
            <div>
              <p className="small dark">APP BUILDER</p>

              <h2>App Sections</h2>

              <p>
                Add and manage the sections of your application.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button className="cancel-btn" onClick={() => setView("preview")}>👁 Preview App</button>
              <button
                className="section-add-btn"
                onClick={() => setShowSectionForm(true)}
                disabled={saving}
              >
                + Add Section
              </button>
            </div>
          </div>

          {showSectionForm && (
            <div className="section-form">
              <h3>Add New Section</h3>

              <label>Section Name</label>

              <input
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                placeholder="Example: Home"
              />

              <label>Section Type</label>

              <select
                value={sectionType}
                onChange={(e) => setSectionType(e.target.value)}
              >
                <option>Text</option>
                <option>Image</option>
                <option>Website</option>
                <option>Video</option>
                <option>Audio</option>
                <option>Gallery</option>
                <option>Contact</option>
                <option>About</option>
                <option>HTML</option>
                <option>Game</option>
                <option>Folder</option>
                <option>Live TV</option>
              </select>

              <div className="form-buttons">
                <button
                  className="cancel-btn"
                  onClick={() => setShowSectionForm(false)}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  className="save-section-btn"
                  onClick={addSection}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Add Section"}
                </button>
              </div>
            </div>
          )}

          {editingSection && renderSectionContentEditor()}

          {!editingSection && (
          <section className="sections-card">
            <div className="section-title">
              <div>
                <h3>Your Sections</h3>

                <p>
                  These sections will appear inside your Android app.
                </p>
              </div>
            </div>

            {sections.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">📄</div>

                <h3>No sections yet</h3>

                <p>
                  Add your first section to start building your app.
                </p>

                <button
                  className="create-btn"
                  onClick={() => setShowSectionForm(true)}
                >
                  + Add First Section
                </button>
              </div>
            ) : (
              <div className="sections-list">
                {sections.map((section, index) => (
                  <div
                    className="section-item"
                    key={section.id}
                  >
                    <div className="drag-icon">☰</div>

                    <div className="section-number">
                      {index + 1}
                    </div>

                    <div className="section-details">
                      <h3>{section.name}</h3>

                      <span>{section.type}</span>
                    </div>

                    <button
                      className="edit-section-btn"
                      onClick={() => openSectionEditor(section)}
                      disabled={saving}
                    >
                      Edit
                    </button>

                    <button
                      className={
                        section.enabled
                          ? "toggle-on"
                          : "toggle-off"
                      }
                      onClick={() => toggleSection(section.id)}
                      disabled={saving}
                    >
                      {section.enabled ? "ON" : "OFF"}
                    </button>

                    <button
                      className="delete-section"
                      onClick={() => deleteSection(section.id)}
                      disabled={saving}
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}
        </main>

        <nav className="bottom-nav">
          <button onClick={goHome}>
            <span>⌂</span>
            Home
          </button>

          <button
            className="active"
            onClick={() => setView("sections")}
          >
            <span>📄</span>
            Sections
          </button>

          <button onClick={() => setView("preview")}>
            <span>👁</span>
            Preview
          </button>

          <button
            onClick={() => setView("settings")}
          >
            <span>⚙</span>
            Settings
          </button>
        </nav>
      </div>
    );
  }

  /* =========================
     SETTINGS SCREEN
  ========================= */


  if (view === "design" && selectedApp) {
    const design = { ...getDesign(selectedApp), ...designDraft };
    const dark = design.appearance === "dark";
    const previewBg = dark ? "#17181d" : design.backgroundColor;
    const previewText = dark ? "#f4f4f6" : design.textColor;
    const cardBg = dark ? "#24252c" : "#ffffff";
    const cardRadius =
      design.cardStyle === "square" ? "4px" :
      design.cardStyle === "soft" ? "12px" :
      design.cardStyle === "pill" ? "30px" : "20px";
    const headerBackground = design.headerGradient ? `linear-gradient(${design.gradientDirection}, ${design.primaryColor}, ${design.gradientColor})` : design.primaryColor;
    const cardShadow = design.cardShadow === "none" ? "none" : design.cardShadow === "strong" ? "0 10px 28px rgba(0,0,0,.20)" : "0 3px 14px rgba(0,0,0,.08)";
    const cardBorder = design.cardBorder === "accent" ? `1px solid ${design.primaryColor}` : design.cardBorder === "thin" ? `1px solid ${divider}` : "none";

    return (
      <div className="app">
        <style>{`
          .design-grid{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:24px;align-items:start}
          .design-panel{background:#fff;border:1px solid #e7e7ef;border-radius:18px;padding:22px;box-shadow:0 8px 28px rgba(20,20,40,.05)}
          .design-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
          .design-field{display:grid;gap:7px}.design-field.full{grid-column:1/-1}
          .design-field label{font-size:13px;font-weight:800}
          .design-field input,.design-field select{width:100%;box-sizing:border-box;border:1px solid #dfe1ea;border-radius:10px;padding:12px;font:inherit;background:#fff}
          .color-row{display:grid;grid-template-columns:52px 1fr;gap:8px}.color-row input[type=color]{width:52px;height:44px;padding:3px}
          .design-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
          .design-phone{position:sticky;top:20px;background:#15161b;border-radius:38px;padding:12px;box-shadow:0 20px 60px rgba(0,0,0,.2)}
          .design-phone-screen{height:680px;max-height:75vh;border-radius:28px;overflow:hidden;display:flex;flex-direction:column}
          .design-preview-header{padding:18px;color:#fff;display:flex;align-items:center;gap:12px}
          .design-preview-header.centered{justify-content:center;text-align:center;flex-direction:column}
          .design-preview-icon{width:48px;height:48px;border-radius:14px;background:rgba(255,255,255,.22);display:grid;place-items:center;font-size:20px;font-weight:800;overflow:hidden}
          .design-preview-icon img{width:100%;height:100%;object-fit:cover}
          .design-preview-body{flex:1;overflow:auto;padding:14px}
          .design-demo-card{padding:16px;margin-bottom:12px;box-shadow:0 3px 14px rgba(0,0,0,.07)}
          .design-demo-card h3{margin:0 0 6px}.design-demo-card p{margin:0;opacity:.72;font-size:13px;line-height:1.5}
          .design-nav{display:flex;justify-content:space-around;padding:12px;border-top:1px solid rgba(120,120,130,.18);font-size:11px}
          .design-side-nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.design-side-nav span{padding:7px 10px;border-radius:8px;background:rgba(120,120,130,.12);font-size:11px}
          @media(max-width:900px){.design-grid{grid-template-columns:1fr}.design-phone{position:static;max-width:390px;margin:auto}}
          @media(max-width:620px){.design-fields{grid-template-columns:1fr}.design-field.full{grid-column:auto}.design-actions{flex-direction:column}.design-actions button{width:100%}}
        `}</style>

        <header className="topbar">
          <div className="brand" onClick={() => setView("home")}>
            <div className="logo">A</div>
            <div>
              <h2>App Creator</h2>
              <p>Design & Appearance</p>
            </div>
          </div>
        </header>

        <main className="container">
          <div className="builder-header">
            <div>
              <button className="back-btn" onClick={() => setView("settings")}>← Back</button>
              <p className="small dark">APP DESIGN</p>
              <h1>Design & Appearance</h1>
              <p>Theme change karein aur right side par live preview dekhein.</p>
            </div>
          </div>

          <div className="design-grid">
            <section className="design-panel">
              <div className="design-fields">
                <div className="design-field full">
                  <label>App Icon / Logo URL</label>
                  <input
                    value={design.iconUrl}
                    onChange={(e) => updateDesignField("iconUrl", e.target.value)}
                    placeholder="https://example.com/icon.png"
                  />
                  <small>Abhi free URL system use ho raha hai. Upload option future mein enable karenge.</small>
                </div>

                <div className="design-field">
                  <label>Primary / Theme Color</label>
                  <div className="color-row">
                    <input type="color" value={design.primaryColor} onChange={(e) => updateDesignField("primaryColor", e.target.value)} />
                    <input value={design.primaryColor} onChange={(e) => updateDesignField("primaryColor", e.target.value)} />
                  </div>
                </div>

                <div className="design-field">
                  <label>Background Color</label>
                  <div className="color-row">
                    <input type="color" value={design.backgroundColor} onChange={(e) => updateDesignField("backgroundColor", e.target.value)} />
                    <input value={design.backgroundColor} onChange={(e) => updateDesignField("backgroundColor", e.target.value)} />
                  </div>
                </div>

                <div className="design-field">
                  <label>Text Color</label>
                  <div className="color-row">
                    <input type="color" value={design.textColor} onChange={(e) => updateDesignField("textColor", e.target.value)} />
                    <input value={design.textColor} onChange={(e) => updateDesignField("textColor", e.target.value)} />
                  </div>
                </div>

                <div className="design-field">
                  <label>App Font</label>
                  <select value={design.fontFamily} onChange={(e) => updateDesignField("fontFamily", e.target.value)}>
                    <option value="Arial, sans-serif">Arial</option>
                    <option value="'Inter', Arial, sans-serif">Inter Style</option>
                    <option value="'Poppins', Arial, sans-serif">Poppins Style</option>
                    <option value="Georgia, serif">Georgia</option>
                    <option value="'Trebuchet MS', sans-serif">Trebuchet</option>
                    <option value="system-ui, sans-serif">System UI</option>
                  </select>
                </div>

                <div className="design-field">
                  <label>Header Color Mode</label>
                  <select value={design.headerGradient ? "gradient" : "solid"} onChange={(e) => updateDesignField("headerGradient", e.target.value === "gradient")}>
                    <option value="solid">Solid Color</option>
                    <option value="gradient">Gradient</option>
                  </select>
                </div>

                {design.headerGradient && <>
                  <div className="design-field">
                    <label>Gradient Second Color</label>
                    <div className="color-row">
                      <input type="color" value={design.gradientColor} onChange={(e) => updateDesignField("gradientColor", e.target.value)} />
                      <input value={design.gradientColor} onChange={(e) => updateDesignField("gradientColor", e.target.value)} />
                    </div>
                  </div>
                  <div className="design-field">
                    <label>Gradient Direction</label>
                    <select value={design.gradientDirection} onChange={(e) => updateDesignField("gradientDirection", e.target.value)}>
                      <option value="90deg">Left → Right</option><option value="135deg">Diagonal</option><option value="180deg">Top → Bottom</option><option value="45deg">Reverse Diagonal</option>
                    </select>
                  </div>
                </>}

                <div className="design-field">
                  <label>Card Shadow</label>
                  <select value={design.cardShadow} onChange={(e) => updateDesignField("cardShadow", e.target.value)}>
                    <option value="none">No Shadow</option><option value="soft">Soft Shadow</option><option value="strong">Strong Shadow</option>
                  </select>
                </div>

                <div className="design-field">
                  <label>Card Border</label>
                  <select value={design.cardBorder} onChange={(e) => updateDesignField("cardBorder", e.target.value)}>
                    <option value="none">None</option><option value="thin">Thin</option><option value="accent">Theme Color</option>
                  </select>
                </div>

                <div className="design-field">
                  <label>Appearance</label>
                  <select value={design.appearance} onChange={(e) => updateDesignField("appearance", e.target.value)}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>

                <div className="design-field">
                  <label>Header Style</label>
                  <select value={design.headerStyle} onChange={(e) => updateDesignField("headerStyle", e.target.value)}>
                    <option value="classic">Classic</option>
                    <option value="centered">Centered</option>
                    <option value="minimal">Minimal</option>
                  </select>
                </div>

                <div className="design-field">
                  <label>Navigation Style</label>
                  <select value={design.navigationStyle} onChange={(e) => updateDesignField("navigationStyle", e.target.value)}>
                    <option value="bottom">Bottom Navigation</option>
                    <option value="top">Top Navigation</option>
                    <option value="left">Left Side Menu</option>
                    <option value="right">Right Side Menu</option>
                    <option value="tabs">Top Tabs</option>
                    <option value="menu">Compact Menu Bar</option>
                  </select>
                </div>

                <div className="design-field">
                  <label>Section / Card Style</label>
                  <select value={design.cardStyle} onChange={(e) => updateDesignField("cardStyle", e.target.value)}>
                    <option value="rounded">Rounded</option>
                    <option value="soft">Soft</option>
                    <option value="square">Square</option>
                    <option value="pill">Pill / Extra Rounded</option>
                    <option value="glass">Glass Style</option>
                    <option value="outline">Outline Style</option>
                  </select>
                </div>
              </div>

              <div className="design-actions">
                <button className="cancel-btn" onClick={() => setView("settings")}>Cancel</button>
                <button className="save-section-btn" onClick={saveDesign} disabled={designSaving}>
                  {designSaving ? "Saving..." : "Save Design"}
                </button>
              </div>
            </section>

            <aside className="design-phone">
              <div className="phone-speaker"></div>
              <div className="design-phone-screen" style={{ background: previewBg, color: previewText, fontFamily: design.fontFamily }}>
                <div
                  className={`design-preview-header ${design.headerStyle === "centered" ? "centered" : ""}`}
                  style={{ background: headerBackground }}
                >
                  {design.headerStyle !== "minimal" && (
                    <div className="design-preview-icon">
                      {design.iconUrl ? <img src={design.iconUrl} alt="" /> : (selectedApp.name?.charAt(0)?.toUpperCase() || "A")}
                    </div>
                  )}
                  <div>
                    <strong>{selectedApp.name}</strong>
                    {design.headerStyle !== "minimal" && <div style={{fontSize:"11px",opacity:.8}}>v{selectedApp.version || "1.0.0"}</div>}
                  </div>
                </div>

                <div className="design-preview-body">
                  {design.navigationStyle !== "bottom" && (
                    <div className="design-side-nav">
                      <span>Home</span><span>Sections</span><span>About</span>
                    </div>
                  )}
                  <div className="design-demo-card" style={{ background: design.cardStyle === "glass" ? "rgba(255,255,255,.14)" : cardBg, borderRadius: cardRadius, boxShadow: cardShadow, border: cardBorder }}>
                    <h3>Welcome</h3>
                    <p>Yahan aapke app ka section content show hoga.</p>
                  </div>
                  <div className="design-demo-card" style={{ background: design.cardStyle === "glass" ? "rgba(255,255,255,.14)" : cardBg, borderRadius: cardRadius, boxShadow: cardShadow, border: cardBorder }}>
                    <h3>Your Sections</h3>
                    <p>{sections.filter((s) => s.enabled).length} enabled section(s)</p>
                  </div>
                </div>

                {design.navigationStyle === "bottom" && (
                  <div className="design-nav" style={{ background: cardBg }}>
                    <span>🏠 Home</span><span>📚 Sections</span><span>ℹ️ About</span>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </main>
      </div>
    );
  }

  if (view === "settings" && selectedApp) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <button className="back-btn" onClick={goHome}>
              ←
            </button>

            <div>
              <h1>{selectedApp.name}</h1>
              <span>App Settings</span>
            </div>
          </div>

          <button className="profile">S</button>
        </header>

        <main className="container">
          <div className="builder-header">
            <div>
              <p className="small dark">
                APP BUILDER
              </p>

              <h2>App Settings</h2>

              <p>
                Basic information and appearance of your application.
              </p>
            </div>

            <button className="save-btn">
              ✓ Saved
            </button>
          </div>

          <div className="builder-layout">
            <aside className="builder-menu">
              <button
                className="menu-active"
                onClick={() => setView("settings")}
              >
                ⚙️ App Settings
              </button>

              <button
                onClick={() => setView("sections")}
              >
                📄 Sections
              </button>

              <button onClick={openDesign}>
                🎨 Design
              </button>

              <button onClick={() => setView("preview")}>
                👁️ Preview
              </button>

              <button onClick={buildApk} disabled={buildingApk}>
                {buildingApk ? "⏳ Building..." : "📦 Build APK"}
              </button>
            </aside>

            <section className="settings-card">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"12px",flexWrap:"wrap",marginBottom:"18px"}}>
                <div>
                  <h3 style={{margin:"0 0 5px"}}>APK Builder</h3>
                  <p className="card-description" style={{margin:0}}>Current app settings ke sath cloud APK build start karein.</p>
                </div>
                <button className="create-btn" onClick={buildApk} disabled={buildingApk}>
                  {buildingApk ? "Starting Build..." : "📦 Build APK"}
                </button>
              </div>

              {buildMessage && (
                <div style={{padding:"12px 14px",borderRadius:"11px",background:"#f3f4ff",border:"1px solid #dedfff",marginBottom:"12px",fontSize:"13px",lineHeight:1.5}}>
                  {buildMessage}
                </div>
              )}

              {buildStatus === "success" && buildRunId && (
                <button
                  className="create-btn"
                  onClick={downloadApk}
                  disabled={downloadingApk}
                  style={{marginBottom:"22px"}}
                >
                  {downloadingApk ? "⏳ Download tayar ho raha hai..." : "⬇️ Download APK"}
                </button>
              )}

              <h3>Basic Information</h3>

              <p className="card-description">
                Enter the information that will be used for your app.
              </p>

              <label>App Name</label>

              <input
                value={selectedApp.name}
                onChange={(e) =>
                  updateApp("name", e.target.value)
                }
                placeholder="Enter app name"
              />

              <label>Description</label>

              <textarea
                value={selectedApp.description}
                onChange={(e) =>
                  updateApp(
                    "description",
                    e.target.value
                  )
                }
                placeholder="Enter app description"
                rows="4"
              />

              <label>Version</label>

              <input
                value={selectedApp.version}
                onChange={(e) =>
                  updateApp(
                    "version",
                    e.target.value
                  )
                }
                placeholder="1.0.0"
              />

              <label>Package Name</label>

              <input
                value={selectedApp.packageName}
                onChange={(e) =>
                  updateApp(
                    "packageName",
                    e.target.value
                  )
                }
                placeholder="com.example.myapp"
              />

              <h3 className="appearance-title">
                Appearance
              </h3>

              <label>Primary Color</label>

              <div className="color-row">
                <input
                  className="color-picker"
                  type="color"
                  value={selectedApp.primaryColor}
                  onChange={(e) =>
                    updateApp(
                      "primaryColor",
                      e.target.value
                    )
                  }
                />

                <input
                  value={selectedApp.primaryColor}
                  onChange={(e) =>
                    updateApp(
                      "primaryColor",
                      e.target.value
                    )
                  }
                />
              </div>

              <div className="preview-box">
                <div
                  className="preview-header"
                  style={{
                    background:
                      selectedApp.primaryColor,
                  }}
                >
                  {selectedApp.name}
                </div>

                <div className="preview-body">
                  <div
                    className="preview-icon"
                    style={{
                      background:
                        selectedApp.primaryColor,
                    }}
                  >
                    A
                  </div>

                  <h3>{selectedApp.name}</h3>

                  <p>
                    {selectedApp.description}
                  </p>

                  <button
                    style={{
                      background:
                        selectedApp.primaryColor,
                    }}
                  >
                    Get Started
                  </button>
                </div>
              </div>
            </section>
          </div>
        </main>

        <nav className="bottom-nav">
          <button onClick={goHome}>
            <span>⌂</span>
            Home
          </button>

          <button
            className="active"
            onClick={() => setView("settings")}
          >
            <span>⚙</span>
            Settings
          </button>

          <button
            onClick={() => setView("sections")}
          >
            <span>📄</span>
            Sections
          </button>

          <button>
            <span>👁</span>
            Preview
          </button>
        </nav>
      </div>
    );
  }

  /* =========================
     HOME / DASHBOARD
  ========================= */

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">A</div>

          <div>
            <h1>My App Creator</h1>

            <span>No-Code App Builder</span>
          </div>
        </div>

        <button className="profile" onClick={handleLogout} title="Logout">
          S
        </button>
      </header>

      <main className="container">
        <section className="welcome">
          <div>
            <p className="small">
              WELCOME BACK
            </p>

            <h2>
              Create your Android app
            </h2>

            <p className="description">
              Build your app without coding.
              Manage sections, design and
              content from one place.
            </p>
          </div>

          <button
            className="create-btn"
            onClick={createApp}
            disabled={saving}
          >
            {saving ? "Creating..." : "+ Create New App"}
          </button>
        </section>

        <section className="stats">
          <div className="stat-card">
            <span>📱</span>

            <div>
              <strong>
                {loadingApps ? "..." : apps.length}
              </strong>

              <p>My Apps</p>
            </div>
          </div>

          <div className="stat-card">
            <span>☁️</span>

            <div>
              <strong>Live</strong>

              <p>Cloud Sync</p>
            </div>
          </div>

          <div className="stat-card">
            <span>⚡</span>

            <div>
              <strong>Ready</strong>

              <p>App Builder</p>
            </div>
          </div>
        </section>

        <section className="apps-section">
          <div className="section-title">
            <div>
              <h3>
                My Applications
              </h3>

              <p>
                Your created apps will appear here.
              </p>
            </div>

            <button
              className="outline-btn"
              onClick={createApp}
              disabled={saving}
            >
              + New App
            </button>
          </div>

          {loadingApps ? (
            <div className="empty">
              <div className="empty-icon">☁️</div>

              <h3>Loading your apps...</h3>

              <p>
                Firebase se apps load ho rahi hain.
              </p>
            </div>
          ) : apps.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                📱
              </div>

              <h3>
                No applications yet
              </h3>

              <p>
                Create your first application
                and start building it.
              </p>

              <button
                className="create-btn"
                onClick={createApp}
                disabled={saving}
              >
                Create My First App
              </button>
            </div>
          ) : (
            <div className="app-grid">
              {apps.map((app) => (
                <div
                  className="app-card"
                  key={app.id}
                >
                  <div
                    className="app-icon"
                    style={{
                      background:
                        app.primaryColor,
                    }}
                  >
                    A
                  </div>

                  <div className="app-info">
                    <h3>
                      {app.name}
                    </h3>

                    <span>
                      {app.status}
                    </span>
                  </div>

                  <button
                    className="edit-btn"
                    onClick={() =>
                      openApp(app)
                    }
                  >
                    Edit App →
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <nav className="bottom-nav">
        <button className="active">
          <span>⌂</span>
          Home
        </button>

        <button>
          <span>📱</span>
          My Apps
        </button>

        <button onClick={createApp}>
          <span>＋</span>
          Create
        </button>

        <button>
          <span>⚙</span>
          Settings
        </button>
      </nav>
    </div>
  );
}

export default App;
