// src/app/api/banners/publish/route.ts
// src/app/api/banners/publish/route.ts

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';

import { db } from '@/db';
import {
  banners,
  instagramConnections,
  facebookConnections,
  whatsappConnections,
  whatsappContacts,
  products,
} from '@/db/schema';

import { eq, and } from 'drizzle-orm';

import {
  getUserIdFromRequest,
  AuthError,
} from '@/lib/auth';

// NOTE: confirm this decrypt function actually exists in your
// facebook-token lib (symmetric counterpart to encryptFacebookToken).
// If your whatsapp access_token is stored encrypted with a different
// helper, swap decryptWhatsappToken below accordingly.
import {
  decryptFacebookToken,
} from '@/lib/facebook-token';

/* =========================================================
   CONFIG
========================================================= */

const META_GRAPH_VERSION =
  process.env.META_GRAPH_VERSION || 'v26.0';

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const IG_GRAPH_API_BASE =
  `https://graph.instagram.com/${META_GRAPH_VERSION}`;

const FB_GRAPH_API_BASE =
  `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const WA_GRAPH_API_BASE =
  `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT ||
  '/var/www/aarnexai.com/aarnexai-backend/upload';


/* =========================================================
   TYPES
========================================================= */

interface PublishBody {
  bannerId: number | string;
  platforms: string[];
}

interface InstagramContainerResponse {
  id?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface InstagramStatusResponse {
  status_code?: string;
  status?: string;
  error_message?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}


function getPublicImageUrl(
  imageUrl: string | null | undefined
): string {
  if (!imageUrl) {
    throw new Error('Banner image URL is missing');
  }

  let url = String(imageUrl).trim();

  if (
    url.startsWith('https://') ||
    url.startsWith('http://')
  ) {
    return url;
  }

  if (!url.startsWith('/')) {
    url = `/${url}`;
  }

  return `${PUBLIC_BASE_URL}${url}`;
}


function safeFileName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}


function getMetaErrorMessage(
  data: any,
  fallback = 'Meta API request failed'
): string {
  return (
    data?.error?.message ||
    data?.error_message ||
    data?.message ||
    fallback
  );
}


async function verifyPublicImage(imageUrl: string) {
  console.log('[Publish] Checking public image URL:', imageUrl);

  const response = await fetch(imageUrl, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type');

  console.log('[Publish] Public image check:', {
    status: response.status,
    contentType,
    finalUrl: response.url,
  });

  return { response, contentType };
}


async function createInstagramJpeg(
  originalImageUrl: string,
  bannerId: string | number
): Promise<string> {

  console.log('[Instagram] Downloading source image:', originalImageUrl);

  const response = await fetch(originalImageUrl, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Could not download banner image. HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const fileName =
    `banner-${safeFileName(String(bannerId))}-instagram-${Date.now()}.jpg`;

  const outputDirectory = path.join(
    UPLOAD_ROOT, 'products', 'banners', 'instagram'
  );

  await fs.mkdir(outputDirectory, { recursive: true });

  const outputPath = path.join(outputDirectory, fileName);

  console.log('[Instagram] Creating JPEG:', outputPath);

  await sharp(inputBuffer)
    .jpeg({ quality: 90, progressive: false })
    .toFile(outputPath);

  const publicUrl =
    `${PUBLIC_BASE_URL}/upload/products/banners/instagram/${fileName}`;

  console.log('[Instagram] Generated public JPEG URL:', publicUrl);

  return publicUrl;
}


async function waitForInstagramContainer(
  containerId: string,
  accessToken: string,
  maxAttempts = 20,
  delayMs = 3000
) {

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {

    const url =
      `${IG_GRAPH_API_BASE}/${containerId}` +
      `?fields=status_code,status,error_message` +
      `&access_token=${encodeURIComponent(accessToken)}`;

    console.log(`[Instagram] Container status check ${attempt}/${maxAttempts}`);

    const response = await fetch(url, { method: 'GET', cache: 'no-store' });
    const data = (await response.json()) as InstagramStatusResponse;

    console.log('[Instagram] Container status:', data);

    if (!response.ok) {
      throw new Error(
        getMetaErrorMessage(data, 'Unable to check Instagram media container')
      );
    }

    const statusCode = String(data.status_code || '').toUpperCase();

    if (statusCode === 'FINISHED') {
      return data;
    }

    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(
        data.error_message ||
        `Instagram media container failed with status ${statusCode}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Instagram media container did not finish processing in time');
}


async function publishToInstagram(params: {
  instagramUserId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
}) {

  const { instagramUserId, accessToken, imageUrl, caption } = params;

  console.log('[Instagram] Creating media container', { instagramUserId, imageUrl });

  const createUrl = `${IG_GRAPH_API_BASE}/${instagramUserId}/media`;
  const createBody = new URLSearchParams();

  createBody.set('image_url', imageUrl);
  createBody.set('caption', caption || '');
  createBody.set('access_token', accessToken);

  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: createBody.toString(),
  });

  const createData = (await createResponse.json()) as InstagramContainerResponse;

  console.log('[Instagram] Create container response:', createData);

  if (!createResponse.ok || !createData.id) {
    throw new Error(
      getMetaErrorMessage(createData, 'Instagram media container creation failed')
    );
  }

  const containerId = createData.id;

  await waitForInstagramContainer(containerId, accessToken);

  console.log('[Instagram] Publishing container:', containerId);

  const publishUrl = `${IG_GRAPH_API_BASE}/${instagramUserId}/media_publish`;
  const publishBody = new URLSearchParams();

  publishBody.set('creation_id', containerId);
  publishBody.set('access_token', accessToken);

  const publishResponse = await fetch(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: publishBody.toString(),
  });

  const publishData = await publishResponse.json();

  console.log('[Instagram] Publish response:', publishData);

  if (!publishResponse.ok || !publishData.id) {
    throw new Error(
      getMetaErrorMessage(publishData, 'Instagram media publishing failed')
    );
  }

  return { mediaId: publishData.id, containerId };
}


/* =========================================================
   FACEBOOK PUBLISHING
========================================================= */

async function publishToFacebook(params: {
  pageId: string;
  pageAccessToken: string;
  imageUrl: string;
  caption: string;
}) {

  const { pageId, pageAccessToken, imageUrl, caption } = params;

  console.log('[Facebook] Publishing photo to page:', pageId);

  const url = `${FB_GRAPH_API_BASE}/${pageId}/photos`;
  const body = new URLSearchParams();

  body.set('url', imageUrl);
  body.set('caption', caption || '');
  body.set('access_token', pageAccessToken);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();

  console.log('[Facebook] Publish response:', data);

  if (!response.ok || (!data.id && !data.post_id)) {
    throw new Error(getMetaErrorMessage(data, 'Facebook publishing failed'));
  }

  return {
    photoId: data.id as string,
    postId: (data.post_id as string) || (data.id as string),
  };
}


/* =========================================================
   WHATSAPP PUBLISHING (broadcast image to contact list)
========================================================= */

async function sendWhatsappImage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  imageUrl: string;
  caption: string;
}) {

  const { phoneNumberId, accessToken, to, imageUrl, caption } = params;

  const url = `${WA_GRAPH_API_BASE}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: {
        link: imageUrl,
        caption: caption || '',
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(getMetaErrorMessage(data, `WhatsApp send failed for ${to}`));
  }

  return data;
}


/**
 * Broadcasts the banner image to every active contact saved by this user.
 *
 * IMPORTANT: WhatsApp Cloud API only allows free-form messages (like an
 * image) within a 24-hour customer service window after the contact last
 * messaged the business. Outside that window, Meta requires an approved
 * message TEMPLATE instead. This function will report per-contact failures
 * (e.g. "re-engagement message" errors) rather than silently succeeding —
 * you may eventually need a template-based fallback for contacts outside
 * the window.
 */
async function publishToWhatsappContacts(params: {
  phoneNumberId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
  contacts: { phoneNumber: string; name: string | null }[];
}) {

  const { phoneNumberId, accessToken, imageUrl, caption, contacts } = params;

  const sent: string[] = [];
  const failed: { phoneNumber: string; error: string }[] = [];

  for (const contact of contacts) {
    try {
      await sendWhatsappImage({
        phoneNumberId,
        accessToken,
        to: contact.phoneNumber,
        imageUrl,
        caption,
      });

      sent.push(contact.phoneNumber);

    } catch (error: any) {
      console.error(
        '[WhatsApp] Failed to send to', contact.phoneNumber, error
      );

      failed.push({
        phoneNumber: contact.phoneNumber,
        error: error?.message || 'Unknown WhatsApp send error',
      });
    }
  }

  return { sent, failed };
}


/* =========================================================
   POST /api/banners/publish
========================================================= */

export async function POST(req: NextRequest) {

  try {

    /* AUTHENTICATION */

    let userId: number;

    try {
      userId = getUserIdFromRequest(req);
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json(
          { success: false, message: error.message },
          { status: 401 }
        );
      }
      throw error;
    }


    /* REQUEST BODY */

    const body = (await req.json()) as PublishBody;
    const bannerId = body?.bannerId;

    const platforms = Array.isArray(body?.platforms) ? body.platforms : [];

    if (!bannerId) {
      return NextResponse.json(
        { success: false, message: 'bannerId is required' },
        { status: 400 }
      );
    }

    if (platforms.length === 0) {
      return NextResponse.json(
        { success: false, message: 'At least one platform is required' },
        { status: 400 }
      );
    }


    /* NORMALIZE PLATFORMS */

    const normalizedPlatforms = platforms.map((platform) =>
      String(platform).toLowerCase().trim()
    );

    const wantsInstagram = normalizedPlatforms.includes('instagram');
    const wantsFacebook = normalizedPlatforms.includes('facebook');
    const wantsWhatsapp = normalizedPlatforms.includes('whatsapp');

    console.log('[Publish] Request:', { userId, bannerId, platforms: normalizedPlatforms });


    /* LOAD BANNER */

    const bannerRows = await db
      .select()
      .from(banners)
      .where(eq(banners.id, Number(bannerId)))
      .limit(1);

    const banner = bannerRows[0];

    if (!banner) {
      return NextResponse.json(
        { success: false, message: 'Banner not found' },
        { status: 404 }
      );
    }

    console.log('[Publish] Banner:', banner);


    /* LOAD PRODUCT */

    let product: any = null;

    if (banner.productId) {
      const productRows = await db
        .select()
        .from(products)
        .where(eq(products.id, banner.productId))
        .limit(1);

      product = productRows[0] || null;
    }


    /* ORIGINAL IMAGE URL */

    const originalImageUrl = getPublicImageUrl(banner.imageUrl);

    console.log('[Publish] DB image URL:', banner.imageUrl);
    console.log('[Publish] FINAL public image URL:', originalImageUrl);


    /* VERIFY ORIGINAL IMAGE — required by every platform, since
       Facebook/Instagram/WhatsApp all fetch this URL server-side. */

    const imageCheck = await verifyPublicImage(originalImageUrl);

    if (!imageCheck.response.ok) {
      return NextResponse.json(
        {
          success: false,
          message: 'Banner image is not publicly accessible',
          imageUrl: originalImageUrl,
          imageStatus: imageCheck.response.status,
          contentType: imageCheck.contentType,
        },
        { status: 400 }
      );
    }


    /* PREPARE INSTAGRAM IMAGE (Instagram specifically wants a JPEG) */

    let instagramImageUrl = originalImageUrl;

    if (wantsInstagram) {

      try {
        instagramImageUrl = await createInstagramJpeg(originalImageUrl, bannerId);
      } catch (error: any) {
        console.error('[Instagram] JPEG conversion failed:', error);
        return NextResponse.json(
          {
            success: false,
            message: 'Failed to prepare banner image for Instagram',
            imageUrl: originalImageUrl,
            error: error?.message || 'JPEG conversion failed',
          },
          { status: 500 }
        );
      }

      const jpegCheck = await verifyPublicImage(instagramImageUrl);

      if (!jpegCheck.response.ok) {
        return NextResponse.json(
          {
            success: false,
            message: 'Generated Instagram JPEG is not publicly accessible',
            imageUrl: instagramImageUrl,
            imageStatus: jpegCheck.response.status,
            contentType: jpegCheck.contentType,
          },
          { status: 400 }
        );
      }

      console.log('[Instagram] Generated JPEG is publicly accessible:', {
        url: instagramImageUrl,
        status: jpegCheck.response.status,
        contentType: jpegCheck.contentType,
      });
    }


    /* CAPTION */

    function toStringArray(value: unknown): string[] {
      if (!value) return [];

      if (Array.isArray(value)) {
        return value.map((v) => String(v));
      }

      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            return parsed.map((v) => String(v));
          }
        } catch {
          return [value];
        }
      }

      return [];
    }

    const captionParts: string[] = [];

    if (banner.caption) {
      captionParts.push(String(banner.caption));
    } else if (product?.title) {
      captionParts.push(String(product.title));
    }

    if (product?.description) {
      captionParts.push(String(product.description));
    }

    const hashtagList = toStringArray(product?.hashtags);

    if (hashtagList.length > 0) {
      const hashtagLine = hashtagList
        .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
        .join(' ');

      captionParts.push(hashtagLine);
    }

    const caption =
      captionParts.join('\n\n').trim() || 'Check out this product!';

    console.log('[Publish] Hashtags used:', hashtagList);
    console.log('[Publish] Caption:', caption);


    /* RESULT */

    const results: Record<string, any> = {};


    /* INSTAGRAM */

    if (wantsInstagram) {

      console.log('[Instagram] Looking for connection:', { userId });

      const connectionRows = await db
        .select()
        .from(instagramConnections)
        .where(eq(instagramConnections.userId, userId))
        .limit(1);

      const connection = connectionRows[0];

      console.log('[Instagram] Connection found:', !!connection);

      if (!connection) {
        results.instagram = {
          success: false,
          message: 'Instagram is not connected. Please connect Instagram first.',
          requiresInstagramConnection: true,
        };
      } else {

        const instagramUserId = String(connection.instagramUserId || '').trim();
        const accessToken = String(connection.accessToken || '').trim();

        if (!instagramUserId || !accessToken) {
          results.instagram = {
            success: false,
            message: 'Instagram connection is missing required fields',
          };
        } else {

          try {
            const instagramResult = await publishToInstagram({
              instagramUserId,
              accessToken,
              imageUrl: instagramImageUrl,
              caption,
            });

            results.instagram = {
              success: true,
              mediaId: instagramResult.mediaId,
              containerId: instagramResult.containerId,
              imageUrl: instagramImageUrl,
            };

          } catch (error: any) {
            console.error('[Instagram] Publishing failed:', error);

            results.instagram = {
              success: false,
              message: error?.message || 'Instagram publishing failed',
              imageUrl: instagramImageUrl,
            };
          }
        }
      }
    }


    /* FACEBOOK */

    if (wantsFacebook) {

      console.log('[Facebook] Looking for connection:', { userId });

      const connectionRows = await db
        .select()
        .from(facebookConnections)
        .where(eq(facebookConnections.userId, userId))
        .limit(1);

      const connection = connectionRows[0];

      console.log('[Facebook] Connection found:', !!connection);

      if (!connection) {
        results.facebook = {
          success: false,
          message: 'Facebook is not connected. Please connect Facebook first.',
          requiresFacebookConnection: true,
        };
      } else if (connection.status !== 'active') {
        results.facebook = {
          success: false,
          message: `Facebook connection status is "${connection.status}". Please reconnect Facebook.`,
        };
      } else {

        const pageId = String(connection.pageId || '').trim();

        let pageAccessToken = '';

        try {
          pageAccessToken = decryptFacebookToken(
            String(connection.accessToken || '')
          );
        } catch (error) {
          console.error('[Facebook] Token decryption failed:', error);
        }

        if (!pageId || !pageAccessToken) {
          results.facebook = {
            success: false,
            message: 'Facebook connection is missing required fields',
          };
        } else {

          try {
            const facebookResult = await publishToFacebook({
              pageId,
              pageAccessToken,
              imageUrl: originalImageUrl,
              caption,
            });

            results.facebook = {
              success: true,
              photoId: facebookResult.photoId,
              postId: facebookResult.postId,
              imageUrl: originalImageUrl,
            };

            // Best-effort — don't fail the whole request if this update fails.
            try {
              await db
                .update(facebookConnections)
                .set({
                  lastPublishAt: new Date(),
                  lastError: null,
                })
                .where(eq(facebookConnections.userId, userId));
            } catch (updateError) {
              console.error('[Facebook] Failed to update lastPublishAt:', updateError);
            }

          } catch (error: any) {
            console.error('[Facebook] Publishing failed:', error);

            results.facebook = {
              success: false,
              message: error?.message || 'Facebook publishing failed',
              imageUrl: originalImageUrl,
            };

            try {
              await db
                .update(facebookConnections)
                .set({ lastError: error?.message || 'Facebook publishing failed' })
                .where(eq(facebookConnections.userId, userId));
            } catch (updateError) {
              console.error('[Facebook] Failed to update lastError:', updateError);
            }
          }
        }
      }
    }


    /* WHATSAPP */

    if (wantsWhatsapp) {

      console.log('[WhatsApp] Looking for connection:', { userId });

      const connectionRows = await db
        .select()
        .from(whatsappConnections)
        .where(eq(whatsappConnections.userId, userId))
        .limit(1);

      const connection = connectionRows[0];

      console.log('[WhatsApp] Connection found:', !!connection);

      if (!connection) {
        results.whatsapp = {
          success: false,
          message: 'WhatsApp is not connected. Please connect WhatsApp first.',
          requiresWhatsappConnection: true,
        };
      } else if (connection.status !== 'active') {
        results.whatsapp = {
          success: false,
          message: `WhatsApp connection status is "${connection.status}". Please reconnect WhatsApp.`,
        };
      } else {

        const phoneNumberId = String(connection.phoneNumberId || '').trim();

        // NOTE: confirm whether this token is stored encrypted like Facebook's.
        // If so, swap this for a decrypt call (e.g. decryptWhatsappToken).
        const accessToken = String(connection.accessToken || '').trim();

        if (!phoneNumberId || !accessToken) {
          results.whatsapp = {
            success: false,
            message: 'WhatsApp connection is missing required fields',
          };
        } else {

          const contactRows = await db
            .select({
              phoneNumber: whatsappContacts.phoneNumber,
              name: whatsappContacts.name,
            })
            .from(whatsappContacts)
            .where(
              and(
                eq(whatsappContacts.userId, userId),
                eq(whatsappContacts.isActive, true)
              )
            );

          console.log('[WhatsApp] Active contacts found:', contactRows.length);

          if (contactRows.length === 0) {
            results.whatsapp = {
              success: false,
              message: 'No active WhatsApp contacts found to broadcast to.',
            };
          } else {

            const { sent, failed } = await publishToWhatsappContacts({
              phoneNumberId,
              accessToken,
              imageUrl: originalImageUrl,
              caption,
              contacts: contactRows,
            });

            results.whatsapp = {
              success: sent.length > 0,
              sentCount: sent.length,
              failedCount: failed.length,
              sent,
              failed,
              imageUrl: originalImageUrl,
            };
          }
        }
      }
    }


    /* FINAL STATUS */

    const successfulPlatforms = Object.entries(results)
      .filter(([, result]) => result?.success === true)
      .map(([platform]) => platform);

    const failedPlatforms = Object.entries(results)
      .filter(([, result]) => result?.success !== true)
      .map(([platform]) => platform);

    if (successfulPlatforms.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'No platform was successfully published',
          bannerId,
          results,
        },
        { status: 400 }
      );
    }


    /* MARK BANNER(S) AS POSTED */

    try {
      await db
        .update(banners)
        .set({ posted: true })
        .where(
          and(
            eq(banners.productId, banner.productId),
            eq(banners.day, banner.day)
          )
        );

      console.log('[Publish] Marked banners as posted:', {
        productId: banner.productId,
        day: banner.day,
      });
    } catch (error) {
      console.error('[Publish] Failed to mark banners as posted:', error);
    }


    /* SUCCESS */

    return NextResponse.json(
      {
        success: failedPlatforms.length === 0,
        message:
          failedPlatforms.length === 0
            ? 'Banner published successfully'
            : 'Banner partially published',
        bannerId,
        publishedPlatforms: successfulPlatforms,
        failedPlatforms,
        results,
      },
      { status: failedPlatforms.length === 0 ? 200 : 207 }
    );

  } catch (error: any) {

    console.error('[Publish] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        message: error?.message || 'Failed to publish banner',
        error:
          process.env.NODE_ENV === 'development'
            ? String(error?.stack || error)
            : undefined,
      },
      { status: 500 }
    );
  }
}