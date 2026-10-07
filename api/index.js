import crypto from "node:crypto";

const GITHUB_OWNER = "sanwal-ai";
const GITHUB_REPO = "my-app-creator";
const GITHUB_WORKFLOW = "android-apk.yml";
const FIREBASE_PROJECT_ID = "myappcreator-2bd13";

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    if (!process.env.GITHUB_TOKEN) {
      return sendJson(res, 500, {
        ok: false,
        error: "GITHUB_TOKEN is missing",
      });
    }

    if (!process.env.ADMIN_UID) {
      return sendJson(res, 500, {
        ok: false,
        error: "ADMIN_UID is missing",
      });
    }

    const authResult = await authenticateAdmin(req);

    if (!authResult.ok) {
      return sendJson(res, authResult.status, {
        ok: false,
        error: authResult.error,
      });
    }

    const requestUrl = new URL(
      req.url,
      `https://${req.headers.host || "localhost"}`
    );

    let route = requestUrl.pathname;

    // Supports:
    // /build
    // /status
    // /download
    // and /api/index?action=build etc.
    const action = requestUrl.searchParams.get("action");

    if (action === "build") route = "/build";
    if (action === "status") route = "/status";
    if (action === "download") route = "/download";

    if (route === "/build") {
      if (req.method !== "POST") {
        return sendJson(res, 405, {
          ok: false,
          error: "Method not allowed",
        });
      }

      return await handleBuild(req, res);
    }

    if (route === "/status") {
      if (req.method !== "GET") {
        return sendJson(res, 405, {
          ok: false,
          error: "Method not allowed",
        });
      }

      return await handleStatus(requestUrl, res);
    }

    if (route === "/download") {
      if (req.method !== "GET") {
        return sendJson(res, 405, {
          ok: false,
          error: "Method not allowed",
        });
      }

      return await handleDownload(requestUrl, res);
    }

    // API health response
    return sendJson(res, 200, {
      ok: true,
      service: "My App Creator API",
      status: "online",
    });
  } catch (error) {
    console.error(error);

    return sendJson(res, 500, {
      ok: false,
      error: "Server error",
      details: error?.message || "Unknown error",
    });
  }
}

// ==========================================================
// CORS
// ==========================================================

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Cache-Control", "no-store");
}

// ==========================================================
// FIREBASE ADMIN AUTH
// ==========================================================

async function authenticateAdmin(req) {
  const authorization =
    String(req.headers.authorization || "");

  if (!authorization.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      error: "Firebase login required",
    };
  }

  const idToken =
    authorization.substring(7).trim();

  if (!idToken) {
    return {
      ok: false,
      status: 401,
      error: "Firebase token missing",
    };
  }

  let firebaseUser;

  try {
    firebaseUser =
      await verifyFirebaseToken(idToken);
  } catch (error) {
    console.error(
      "Firebase verification:",
      error?.message
    );

    return {
      ok: false,
      status: 401,
      error: "Invalid Firebase login",
    };
  }

  if (
    firebaseUser.sub !==
    process.env.ADMIN_UID
  ) {
    return {
      ok: false,
      status: 403,
      error: "You are not authorized",
    };
  }

  return {
    ok: true,
    user: firebaseUser,
  };
}

// ==========================================================
// BUILD APK
// ==========================================================

async function handleBuild(req, res) {
  const body = req.body || {};

  const appId =
    String(body.app_id || "").trim();

  const appName =
    String(body.app_name || "").trim();

  const packageName =
    String(body.package_name || "").trim();

  const versionName =
    String(body.version_name || "1.0.0").trim();

  const versionCode =
    String(body.version_code || "1").trim();

  const iconUrl =
    String(body.icon_url || "").trim();

  if (!/^[0-9]+$/.test(appId)) {
    return sendJson(res, 400, {
      ok: false,
      error: "Invalid app_id",
    });
  }

  if (
    !appName ||
    appName.length > 80 ||
    /[\r\n]/.test(appName)
  ) {
    return sendJson(res, 400, {
      ok: false,
      error: "Invalid app_name",
    });
  }

  const packageRegex =
    /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

  if (
    !packageRegex.test(packageName) ||
    packageName.length > 180
  ) {
    return sendJson(res, 400, {
      ok: false,
      error: "Invalid package_name",
    });
  }

  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/.test(
      versionName
    )
  ) {
    return sendJson(res, 400, {
      ok: false,
      error: "Invalid version_name",
    });
  }

  if (!/^[1-9][0-9]{0,8}$/.test(versionCode)) {
    return sendJson(res, 400, {
      ok: false,
      error: "Invalid version_code",
    });
  }

  if (iconUrl) {
    if (
      iconUrl.length > 2000 ||
      !/^https:\/\//i.test(iconUrl)
    ) {
      return sendJson(res, 400, {
        ok: false,
        error:
          "Invalid icon_url. HTTPS URL required.",
      });
    }
  }

  const githubURL =
    `https://api.github.com/repos/` +
    `${GITHUB_OWNER}/${GITHUB_REPO}/actions/` +
    `workflows/${GITHUB_WORKFLOW}/dispatches`;

  const githubResponse =
    await githubFetch(githubURL, {
      method: "POST",

      body: JSON.stringify({
        ref: "main",

        inputs: {
          app_id: appId,
          app_name: appName,
          package_name: packageName,
          version_name: versionName,
          version_code: versionCode,
          icon_url: iconUrl,
        },
      }),
    });

  if (githubResponse.status !== 204) {
    const errorText =
      await githubResponse.text();

    return sendJson(res, 502, {
      ok: false,
      error:
        "GitHub APK build could not be started",
      github_status:
        githubResponse.status,
      details:
        errorText.slice(0, 500),
    });
  }

  return sendJson(res, 200, {
    ok: true,
    message:
      "APK build successfully started",
    app_id: appId,
    app_name: appName,
    package_name: packageName,
    version_name: versionName,
    version_code: versionCode,
    icon_url: iconUrl,
  });
}

// ==========================================================
// BUILD STATUS
// ==========================================================

async function handleStatus(url, res) {
  const appId =
    String(
      url.searchParams.get("app_id") || ""
    ).trim();

  if (!/^[0-9]+$/.test(appId)) {
    return sendJson(res, 400, {
      ok: false,
      error: "Invalid app_id",
    });
  }

  const runsURL =
    `https://api.github.com/repos/` +
    `${GITHUB_OWNER}/${GITHUB_REPO}/actions/` +
    `workflows/${GITHUB_WORKFLOW}/runs` +
    `?event=workflow_dispatch&branch=main&per_page=20`;

  const runsResponse =
    await githubFetch(runsURL);

  if (!runsResponse.ok) {
    return sendJson(res, 502, {
      ok: false,
      error:
        "Could not load GitHub build status",
    });
  }

  const runsData =
    await runsResponse.json();

  const runs =
    Array.isArray(runsData.workflow_runs)
      ? runsData.workflow_runs
      : [];

  if (runs.length === 0) {
    return sendJson(res, 200, {
      ok: true,
      found: false,
      status: "not_found",
      message:
        "No APK build found yet",
    });
  }

  let matchedRun = null;

  for (const run of runs) {
    const jobsURL =
      `https://api.github.com/repos/` +
      `${GITHUB_OWNER}/${GITHUB_REPO}/actions/` +
      `runs/${run.id}/jobs?per_page=100`;

    const jobsResponse =
      await githubFetch(jobsURL);

    if (!jobsResponse.ok) {
      continue;
    }

    const jobsData =
      await jobsResponse.json();

    const jobs =
      Array.isArray(jobsData.jobs)
        ? jobsData.jobs
        : [];

    const searchableText =
      JSON.stringify(jobs).toLowerCase();

    if (
      searchableText.includes(
        appId.toLowerCase()
      )
    ) {
      matchedRun = run;
      break;
    }
  }

  // Fallback to newest workflow_dispatch run
  if (!matchedRun) {
    matchedRun = runs[0];
  }

  const githubStatus =
    matchedRun.status || "unknown";

  const conclusion =
    matchedRun.conclusion || null;

  let builderStatus = "building";

  if (githubStatus === "completed") {
    builderStatus =
      conclusion === "success"
        ? "success"
        : "failed";
  } else if (githubStatus === "queued") {
    builderStatus = "queued";
  }

  let artifactAvailable = false;

  if (
    githubStatus === "completed" &&
    conclusion === "success"
  ) {
    const artifacts =
      await getRunArtifacts(
        matchedRun.id
      );

    artifactAvailable =
      artifacts.length > 0;
  }

  return sendJson(res, 200, {
    ok: true,
    found: true,

    app_id: appId,

    run_id:
      String(matchedRun.id),

    status:
      builderStatus,

    github_status:
      githubStatus,

    conclusion,

    artifact_available:
      artifactAvailable,

    created_at:
      matchedRun.created_at,

    updated_at:
      matchedRun.updated_at,
  });
}

// ==========================================================
// DOWNLOAD APK ARTIFACT
// ==========================================================

async function handleDownload(url, res) {
  const runId =
    String(
      url.searchParams.get("run_id") || ""
    ).trim();

  if (!/^[0-9]+$/.test(runId)) {
    return sendJson(res, 400, {
      ok: false,
      error: "Invalid run_id",
    });
  }

  const artifacts =
    await getRunArtifacts(runId);

  if (artifacts.length === 0) {
    return sendJson(res, 404, {
      ok: false,
      error: "APK artifact not found",
    });
  }

  const artifact =
    artifacts.find((item) =>
      String(item.name || "")
        .toLowerCase()
        .includes("apk")
    ) || artifacts[0];

  const archiveURL =
    `https://api.github.com/repos/` +
    `${GITHUB_OWNER}/${GITHUB_REPO}/actions/` +
    `artifacts/${artifact.id}/zip`;

  const downloadResponse =
    await githubFetch(archiveURL, {
      redirect: "manual",
    });

  if (
    downloadResponse.status >= 300 &&
    downloadResponse.status < 400
  ) {
    const location =
      downloadResponse.headers.get(
        "location"
      );

    if (!location) {
      return sendJson(res, 502, {
        ok: false,
        error:
          "GitHub download URL missing",
      });
    }

    return sendJson(res, 200, {
      ok: true,
      artifact_name:
        artifact.name,
      download_url:
        location,
    });
  }

  if (downloadResponse.ok) {
    // Vercel may follow the GitHub redirect itself.
    // Return a temporary download through this API.
    const arrayBuffer =
      await downloadResponse.arrayBuffer();

    res.statusCode = 200;
    res.setHeader(
      "Content-Type",
      downloadResponse.headers.get(
        "content-type"
      ) || "application/zip"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFileName(
        artifact.name || "apk"
      )}.zip"`
    );

    return res.end(
      Buffer.from(arrayBuffer)
    );
  }

  return sendJson(res, 502, {
    ok: false,
    error:
      "Could not create APK download",
    github_status:
      downloadResponse.status,
  });
}

// ==========================================================
// GET ARTIFACTS
// ==========================================================

async function getRunArtifacts(runId) {
  const artifactsURL =
    `https://api.github.com/repos/` +
    `${GITHUB_OWNER}/${GITHUB_REPO}/actions/` +
    `runs/${runId}/artifacts?per_page=100`;

  const response =
    await githubFetch(artifactsURL);

  if (!response.ok) {
    return [];
  }

  const data =
    await response.json();

  return Array.isArray(data.artifacts)
    ? data.artifacts.filter(
        (artifact) => !artifact.expired
      )
    : [];
}

// ==========================================================
// GITHUB HELPER
// ==========================================================

async function githubFetch(
  url,
  options = {}
) {
  const headers =
    new Headers(options.headers || {});

  headers.set(
    "Authorization",
    `Bearer ${process.env.GITHUB_TOKEN}`
  );

  headers.set(
    "Accept",
    "application/vnd.github+json"
  );

  headers.set(
    "X-GitHub-Api-Version",
    "2022-11-28"
  );

  headers.set(
    "User-Agent",
    "MyAppCreator-Vercel"
  );

  if (
    options.body &&
    !headers.has("Content-Type")
  ) {
    headers.set(
      "Content-Type",
      "application/json"
    );
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

// ==========================================================
// FIREBASE TOKEN VERIFICATION
// ==========================================================

async function verifyFirebaseToken(token) {
  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new Error(
      "Invalid JWT format"
    );
  }

  const header =
    JSON.parse(
      base64UrlToBuffer(
        parts[0]
      ).toString("utf8")
    );

  const payload =
    JSON.parse(
      base64UrlToBuffer(
        parts[1]
      ).toString("utf8")
    );

  if (header.alg !== "RS256") {
    throw new Error(
      "Invalid token algorithm"
    );
  }

  if (!header.kid) {
    throw new Error(
      "Token signing key missing"
    );
  }

  const expectedIssuer =
    `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

  if (
    payload.iss !== expectedIssuer
  ) {
    throw new Error(
      "Invalid token issuer"
    );
  }

  if (
    payload.aud !==
    FIREBASE_PROJECT_ID
  ) {
    throw new Error(
      "Invalid token audience"
    );
  }

  if (!payload.sub) {
    throw new Error(
      "Firebase UID missing"
    );
  }

  const now =
    Math.floor(Date.now() / 1000);

  if (
    !payload.exp ||
    payload.exp <= now
  ) {
    throw new Error(
      "Firebase login expired"
    );
  }

  if (
    payload.iat &&
    payload.iat > now + 60
  ) {
    throw new Error(
      "Invalid token time"
    );
  }

  const keyResponse =
    await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
    );

  if (!keyResponse.ok) {
    throw new Error(
      "Could not load Firebase signing keys"
    );
  }

  const jwks =
    await keyResponse.json();

  const jwk =
    jwks.keys.find(
      (key) =>
        key.kid === header.kid
    );

  if (!jwk) {
    throw new Error(
      "Firebase signing key not found"
    );
  }

  const publicKey =
    crypto.createPublicKey({
      key: jwk,
      format: "jwk",
    });

  const verifier =
    crypto.createVerify(
      "RSA-SHA256"
    );

  verifier.update(
    `${parts[0]}.${parts[1]}`
  );

  verifier.end();

  const valid =
    verifier.verify(
      publicKey,
      base64UrlToBuffer(parts[2])
    );

  if (!valid) {
    throw new Error(
      "Invalid Firebase token signature"
    );
  }

  return payload;
}

// ==========================================================
// HELPERS
// ==========================================================

function base64UrlToBuffer(value) {
  let normalized =
    String(value)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  while (
    normalized.length % 4
  ) {
    normalized += "=";
  }

  return Buffer.from(
    normalized,
    "base64"
  );
}

function safeFileName(value) {
  return String(value)
    .replace(
      /[^a-zA-Z0-9._-]+/g,
      "-"
    )
    .replace(
      /^[-_.]+|[-_.]+$/g,
      ""
    )
    .slice(0, 100) || "apk";
}

function sendJson(
  res,
  status,
  data
) {
  setCors(res);

  return res
    .status(status)
    .json(data);
}
