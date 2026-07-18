'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NaiClient } = require('../lib/nai-client');

test('credits use the image endpoint user-data route', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      async json() {
        return {
          subscription: {
            trainingStepsLeft: {
              fixedTrainingStepsLeft: 7,
              purchasedTrainingSteps: 5,
            },
          },
        };
      },
    };
  };

  const client = new NaiClient();
  client.token = 'test-token';
  assert.equal(await client.getCredits(), 12);
  assert.equal(requestedUrl, 'https://image.novelai.net/user/data');
});

test('token validation preserves auth classification on the image endpoint', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const requestedUrls = [];
  global.fetch = async (url) => {
    requestedUrls.push(url);
    return { ok: false, status: 401 };
  };

  const client = new NaiClient();
  assert.equal(await client.validateToken('expired-token'), 'invalid');
  assert.deepEqual(requestedUrls, ['https://image.novelai.net/user/data']);
});
