///src/app/api/meta/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { instagramConnections, users } from "@/db/schema";
import { eq } from "drizzle-orm";

const INSTAGRAM_TOKEN_URL =
  "https://api.instagram.com/oauth/access_token";

const INSTAGRAM_GRAPH_URL =
  "https://graph.instagram.com";

function getFrontendUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_FRONTEND_URL ||
    "http://localhost:8100"
  ).replace(/\/+$/, "");
}

function redirectToFrontend(
  path: string,
  params: Record<string, string>
) {
  const url = new URL(`${getFrontendUrl()}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url);
}

function decodeState(state: string) {
  try {
    const base64 = state
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const padded =
      base64 + "=".repeat((4 - (base64.length % 4)) % 4);

    const json = Buffer.from(padded, "base64").toString("utf8");

    return JSON.parse(json) as {
      userId: number;
      bannerId?: number;
      timestamp?: number;
    };
  } catch (error) {
    console.error("Failed to decode Instagram OAuth state:", error);
    return null;
  }
}

export async function GET(req: NextRequest) {
  // TEMP DIAGNOSTICS — unique ID per request, to catch duplicate calls
  // hitting this route with the same authorization code (a very common
  // cause of "Error validating verification code").
  const requestId = Math.random().toString(36).slice(2, 8);

  console.log("========================================");
  console.log(`[${requestId}] Instagram OAuth callback started`);
  console.log("========================================");

  try {
    const { searchParams } = new URL(req.url);

    const code = searchParams.get("code");
    const state = searchParams.get("state");

    const oauthError = searchParams.get("error");
    const oauthErrorReason = searchParams.get("error_reason");
    const oauthErrorDescription =
      searchParams.get("error_description");

    console.log(`[${requestId}] Callback params:`, {
      hasCode: !!code,
      codePrefix: code ? code.slice(0, 24) : null,
      codeLength: code ? code.length : 0,
      hasState: !!state,
      oauthError,
      oauthErrorReason,
      oauthErrorDescription,
    });

    // ---------------------------------------------------------
    // 1. Instagram returned an OAuth error
    // ---------------------------------------------------------

    if (oauthError) {
      console.error(`[${requestId}] Instagram OAuth error:`, {
        oauthError,
        oauthErrorReason,
        oauthErrorDescription,
      });

      return redirectToFrontend("/posters", {
        instagram: "error",
        message:
          oauthErrorDescription ||
          oauthErrorReason ||
          oauthError ||
          "instagram_oauth_error",
      });
    }

    // ---------------------------------------------------------
    // 2. Validate code/state
    // ---------------------------------------------------------

    if (!code) {
      console.error(`[${requestId}] Instagram callback missing code`);

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "missing_code",
      });
    }

    if (!state) {
      console.error(`[${requestId}] Instagram callback missing state`);

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "missing_state",
      });
    }

    // ---------------------------------------------------------
    // 3. Decode OAuth state
    // ---------------------------------------------------------

    const stateData = decodeState(state);

    if (!stateData || !stateData.userId) {
      console.error(`[${requestId}] Invalid Instagram OAuth state`);

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "invalid_state",
      });
    }

    const userId = Number(stateData.userId);
    const bannerId = stateData.bannerId
      ? Number(stateData.bannerId)
      : undefined;

    console.log(`[${requestId}] Instagram OAuth belongs to user:`, userId);
    console.log(`[${requestId}] Instagram OAuth banner:`, bannerId);

    if (!Number.isFinite(userId) || userId <= 0) {
      console.error(`[${requestId}] Invalid userId in OAuth state:`, userId);

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "invalid_user",
      });
    }

    // ---------------------------------------------------------
    // 4. Environment variables
    // ---------------------------------------------------------

    const clientId = process.env.META_APP_ID;
    const clientSecret = process.env.META_APP_SECRET;

    const redirectUri =
      process.env.META_REDIRECT_URI ||
      "https://aarnexai.com/aarnexai-backend/api/meta/callback";

    // TEMP DIAGNOSTICS — compare this exactly against the connect route's
    // redirectUriJSON / redirectUriLength in the logs.
    console.log(`[${requestId}] Using Instagram redirect URI:`, redirectUri);
    console.log(`[${requestId}] Redirect URI JSON:`, JSON.stringify(redirectUri));
    console.log(`[${requestId}] Redirect URI length:`, redirectUri.length);
    console.log(`[${requestId}] Client ID:`, clientId);

    if (!clientId) {
      console.error(`[${requestId}] META_APP_ID is missing`);

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "missing_app_id",
      });
    }

    if (!clientSecret) {
      console.error(`[${requestId}] META_APP_SECRET is missing`);

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "missing_app_secret",
      });
    }

    // ---------------------------------------------------------
    // 5. Exchange authorization code -> short-lived token
    // ---------------------------------------------------------

    console.log(`[${requestId}] Exchanging Instagram authorization code...`);

    const shortTokenBody = new URLSearchParams();

    shortTokenBody.set("client_id", clientId);
    shortTokenBody.set("client_secret", clientSecret);
    shortTokenBody.set("grant_type", "authorization_code");
    shortTokenBody.set("redirect_uri", redirectUri);
    shortTokenBody.set("code", code);

    const shortTokenResponse = await fetch(
      INSTAGRAM_TOKEN_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: shortTokenBody.toString(),
        cache: "no-store",
      }
    );

    const shortTokenText = await shortTokenResponse.text();

    console.log(
      `[${requestId}] Instagram short token response status:`,
      shortTokenResponse.status
    );

    if (!shortTokenResponse.ok) {
      console.error(
        `[${requestId}] Instagram short token exchange failed:`,
        shortTokenText
      );

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "short_token_exchange",
      });
    }

    let shortTokenData: any;

    try {
      shortTokenData = JSON.parse(shortTokenText);
    } catch {
      console.error(
        `[${requestId}] Invalid JSON from Instagram short token response:`,
        shortTokenText
      );

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "invalid_short_token_response",
      });
    }

    const shortAccessToken = shortTokenData?.access_token;
    const shortInstagramUserId = shortTokenData?.user_id;

    if (!shortAccessToken) {
      console.error(
        `[${requestId}] Instagram short token missing access_token:`,
        shortTokenData
      );

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "missing_short_token",
      });
    }

    console.log(
      `[${requestId}] Instagram short token received for IG user:`,
      shortInstagramUserId
    );

    // ---------------------------------------------------------
    // 6. Exchange short-lived -> long-lived token
    // ---------------------------------------------------------

    console.log(`[${requestId}] Exchanging short token for long-lived token...`);

    const longTokenUrl = new URL(`${INSTAGRAM_GRAPH_URL}/access_token`);

    longTokenUrl.searchParams.set("grant_type", "ig_exchange_token");
    longTokenUrl.searchParams.set("client_secret", clientSecret);
    longTokenUrl.searchParams.set("access_token", shortAccessToken);

    const longTokenResponse = await fetch(
      longTokenUrl.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    const longTokenText = await longTokenResponse.text();

    console.log(
      `[${requestId}] Instagram long token response status:`,
      longTokenResponse.status
    );

    console.log(
      `[${requestId}] Instagram long token raw response:`,
      longTokenText
    );

    if (!longTokenResponse.ok) {
      console.error(
        `[${requestId}] Instagram long-lived token exchange failed:`,
        {
          status: longTokenResponse.status,
          response: longTokenText,
        }
      );

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "long_token_exchange",
      });
    }

    let longTokenData: any;

    try {
      longTokenData = JSON.parse(longTokenText);
    } catch {
      console.error(
        `[${requestId}] Invalid JSON from long token response:`,
        longTokenText
      );

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "invalid_long_token_response",
      });
    }

    const longAccessToken = longTokenData?.access_token;
    const expiresIn = Number(longTokenData?.expires_in) || 0;

    if (!longAccessToken) {
      console.error(
        `[${requestId}] Long token response has no access_token:`,
        longTokenData
      );

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "missing_long_token",
      });
    }

    console.log(`[${requestId}] Instagram long-lived token received successfully`);
    console.log(`[${requestId}] Long token expires in:`, expiresIn);

    // ---------------------------------------------------------
    // 7. Calculate token expiry
    // ---------------------------------------------------------

    const tokenExpiresAt =
      expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000)
        : null;

    console.log(`[${requestId}] Instagram token expires at:`, tokenExpiresAt);

    // ---------------------------------------------------------
    // 8. Get Instagram profile
    // ---------------------------------------------------------

    console.log(`[${requestId}] Fetching Instagram profile...`);

    const profileUrl = new URL(`${INSTAGRAM_GRAPH_URL}/me`);

    profileUrl.searchParams.set(
      "fields",
      "user_id,username,name,profile_picture_url"
    );

    profileUrl.searchParams.set("access_token", longAccessToken);

    const profileResponse = await fetch(
      profileUrl.toString(),
      {
        method: "GET",
        cache: "no-store",
      }
    );

    const profileText = await profileResponse.text();

    console.log(
      `[${requestId}] Instagram profile response status:`,
      profileResponse.status
    );

    if (!profileResponse.ok) {
      console.error(
        `[${requestId}] Instagram profile request failed:`,
        profileText
      );

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "instagram_profile",
      });
    }

    let profileData: any;

    try {
      profileData = JSON.parse(profileText);
    } catch {
      console.error(
        `[${requestId}] Invalid Instagram profile response:`,
        profileText
      );

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "invalid_profile_response",
      });
    }

    console.log(`[${requestId}] Instagram profile:`, {
      user_id: profileData?.user_id,
      username: profileData?.username,
      name: profileData?.name,
    });

    // ---------------------------------------------------------
    // 9. Determine Instagram user ID
    // ---------------------------------------------------------

    const instagramUserId = String(
      profileData?.user_id ||
        profileData?.id ||
        shortInstagramUserId ||
        ""
    );

    if (!instagramUserId) {
      console.error(`[${requestId}] Instagram user ID could not be determined`);

      return redirectToFrontend("/posters", {
        instagram: "error",
        message: "missing_instagram_user_id",
      });
    }

    const instagramUsername = profileData?.username || null;
    const instagramName = profileData?.name || null;
    const instagramProfilePicture =
      profileData?.profile_picture_url || null;

    // ---------------------------------------------------------
    // 10. Check existing Instagram connection
    // ---------------------------------------------------------

    console.log(
      `[${requestId}] Checking existing Instagram connection:`,
      instagramUserId
    );

    const existingConnections = await db
      .select()
      .from(instagramConnections)
      .where(
        eq(
          instagramConnections.instagramUserId,
          instagramUserId
        )
      )
      .limit(1);

    const existingConnection = existingConnections[0];

    // ---------------------------------------------------------
    // 11. Existing connection
    // ---------------------------------------------------------

    if (existingConnection) {
      console.log(`[${requestId}] Existing Instagram connection found:`, {
        connectionId: existingConnection.id,
        dbUserId: existingConnection.userId,
        currentUserId: userId,
        instagramUserId,
      });

      if (Number(existingConnection.userId) === userId) {
        console.log(`[${requestId}] Updating existing Instagram connection...`);

        await db
          .update(instagramConnections)
          .set({
            instagramUsername,
            instagramName,
            instagramProfilePicture,
            accessToken: longAccessToken,
            tokenExpiresAt,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(instagramConnections.id, existingConnection.id));

        console.log(`[${requestId}] Instagram connection updated successfully`);
      } else {
        console.error(
          `[${requestId}] Instagram account already connected to another BizMyntra user`
        );

        return redirectToFrontend("/posters", {
          instagram: "error",
          message: "instagram_already_connected",
        });
      }
    } else {
      // -------------------------------------------------------
      // 12. New Instagram connection
      // -------------------------------------------------------

      console.log(`[${requestId}] Creating new Instagram connection...`);

      const inserted = await db
        .insert(instagramConnections)
        .values({
          userId,
          instagramUserId,
          instagramUsername,
          instagramName,
          instagramProfilePicture,
          accessToken: longAccessToken,
          tokenExpiresAt,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .$returningId();

      console.log(`[${requestId}] Instagram connection created:`, inserted);
    }

    // ---------------------------------------------------------
    // 13. Mark user as Instagram connected
    // ---------------------------------------------------------

    console.log(`[${requestId}] Updating users.instagramConnected...`);

    await db
      .update(users)
      .set({
        instagramConnected: true,
      })
      .where(eq(users.id, userId));

    console.log(`[${requestId}] users.instagramConnected updated successfully`);

    // ---------------------------------------------------------
    // 14. Verify DB record
    // ---------------------------------------------------------

    const savedConnections = await db
      .select()
      .from(instagramConnections)
      .where(eq(instagramConnections.userId, userId))
      .limit(1);

    console.log(`[${requestId}] Instagram DB verification:`, {
      found: savedConnections.length > 0,
      connectionId: savedConnections[0]?.id,
      instagramUserId: savedConnections[0]?.instagramUserId,
      username: savedConnections[0]?.instagramUsername,
      status: savedConnections[0]?.status,
    });

    // ---------------------------------------------------------
    // 15. Redirect frontend
    // ---------------------------------------------------------

    console.log(`[${requestId}] Instagram connection completed successfully`);

    return redirectToFrontend("/posters", {
      instagram: "connected",
      ...(bannerId ? { bannerId: String(bannerId) } : {}),
    });
  } catch (error: any) {
    console.error("========================================");
    console.error(`[${requestId}] Instagram callback fatal error:`);
    console.error(error);
    console.error("========================================");

    return redirectToFrontend("/posters", {
      instagram: "error",
      message: error?.message || "instagram_callback_failed",
    });
  }
}