/**
 * Automated Cloudflare Worker Deployment Script
 * 
 * This script deploys the Bybit API relay Worker to Cloudflare automatically
 * using the Cloudflare API - no manual CLI setup required!
 */

import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { strategies } from '../shared/schema';
import { eq } from 'drizzle-orm';

interface DeploymentConfig {
  cloudflareApiToken: string;
  cloudflareAccountId: string;
  bybitApiKey: string;
  bybitApiSecret: string;
}

async function getBybitCredentials() {
  const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error('Database URL not found');
  }

  const sql = neon(databaseUrl);
  const db = drizzle(sql);

  // Get the first active strategy with Bybit credentials
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.isActive, true))
    .limit(1);

  if (!strategy?.bybitApiKey || !strategy?.bybitApiSecret) {
    throw new Error('No Bybit API credentials found in database. Please configure them in the app settings first.');
  }

  return {
    apiKey: strategy.bybitApiKey,
    apiSecret: strategy.bybitApiSecret,
  };
}

const WORKER_NAME = 'bybit-api-relay';

async function deployWorker(config: DeploymentConfig) {
  const { cloudflareApiToken, cloudflareAccountId, bybitApiKey, bybitApiSecret } = config;

  console.log('🚀 Starting automated Worker deployment...\n');

  // Generate random auth token for Replit <-> Worker communication
  const relayAuthToken = randomBytes(32).toString('hex');

  // Read the Worker script
  const workerScript = readFileSync('cloudflare-worker/worker.js', 'utf-8');

  try {
    // Step 1: Upload Worker script
    console.log('📤 Uploading Worker script to Cloudflare...');
    const uploadResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/workers/scripts/${WORKER_NAME}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${cloudflareApiToken}`,
          'Content-Type': 'application/javascript',
        },
        body: workerScript,
      }
    );

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      throw new Error(`Failed to upload Worker: ${error}`);
    }

    console.log('✅ Worker script uploaded successfully\n');

    // Step 2: Set secrets
    console.log('🔐 Configuring Worker secrets...');
    
    const secrets = [
      { name: 'BYBIT_API_KEY', value: bybitApiKey },
      { name: 'BYBIT_API_SECRET', value: bybitApiSecret },
      { name: 'RELAY_AUTH_TOKEN', value: relayAuthToken },
    ];

    for (const secret of secrets) {
      const secretResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/workers/scripts/${WORKER_NAME}/secrets`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${cloudflareApiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: secret.name,
            text: secret.value,
            type: 'secret_text',
          }),
        }
      );

      if (!secretResponse.ok) {
        const error = await secretResponse.text();
        throw new Error(`Failed to set secret ${secret.name}: ${error}`);
      }

      console.log(`  ✓ Set ${secret.name}`);
    }

    console.log('\n✅ All secrets configured\n');

    // Step 3: Deploy to subdomain
    console.log('🌐 Deploying Worker to subdomain...');
    
    const deployResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/workers/scripts/${WORKER_NAME}/subdomain`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cloudflareApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
        }),
      }
    );

    if (!deployResponse.ok) {
      const error = await deployResponse.text();
      throw new Error(`Failed to deploy Worker: ${error}`);
    }

    const deployData = await deployResponse.json();
    
    // Construct Worker URL
    const workerUrl = `https://${WORKER_NAME}.${deployData.result.subdomain}.workers.dev`;

    console.log('✅ Worker deployed successfully!\n');

    // Test the Worker
    console.log('🧪 Testing Worker health endpoint...');
    const healthResponse = await fetch(`${workerUrl}/health`);
    
    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      console.log('✅ Worker is healthy:', healthData);
    } else {
      console.log('⚠️  Worker deployed but health check failed');
    }

    // Output configuration
    console.log('\n' + '='.repeat(60));
    console.log('✨ DEPLOYMENT SUCCESSFUL!');
    console.log('='.repeat(60));
    console.log('\nAdd these to your Replit Secrets:');
    console.log(`\nBYBIT_WORKER_URL=${workerUrl}`);
    console.log(`BYBIT_WORKER_AUTH_TOKEN=${relayAuthToken}`);
    console.log('\n' + '='.repeat(60));

    return {
      success: true,
      workerUrl,
      authToken: relayAuthToken,
    };

  } catch (error) {
    console.error('\n❌ Deployment failed:', error);
    throw error;
  }
}

// Main execution
async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   Bybit API Relay - Automated Deployment     ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  // Get configuration from environment
  const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN || '';
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';

  // Validate Cloudflare configuration
  if (!cloudflareApiToken) {
    console.error('❌ CLOUDFLARE_API_TOKEN is required');
    console.log('\nGet your API token from: https://dash.cloudflare.com/profile/api-tokens');
    console.log('Create a token with "Edit Cloudflare Workers" permissions');
    console.log('\nThen add it to Replit Secrets as: CLOUDFLARE_API_TOKEN');
    process.exit(1);
  }

  if (!cloudflareAccountId) {
    console.error('❌ CLOUDFLARE_ACCOUNT_ID is required');
    console.log('\nFind your Account ID at: https://dash.cloudflare.com/ (right sidebar)');
    console.log('Then add it to Replit Secrets as: CLOUDFLARE_ACCOUNT_ID');
    process.exit(1);
  }

  // Get Bybit credentials from database
  console.log('🔍 Fetching Bybit credentials from database...');
  let bybitCreds;
  try {
    bybitCreds = await getBybitCredentials();
    console.log('✅ Found Bybit credentials in database\n');
  } catch (error: any) {
    console.error('❌', error.message);
    process.exit(1);
  }

  const config: DeploymentConfig = {
    cloudflareApiToken,
    cloudflareAccountId,
    bybitApiKey: bybitCreds.apiKey,
    bybitApiSecret: bybitCreds.apiSecret,
  };

  try {
    const result = await deployWorker(config);
    
    if (result.success) {
      console.log('\n🎉 Deployment complete! Your Bybit API relay is live!');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n💥 Deployment failed. Please check the errors above.');
    process.exit(1);
  }
}

main();
