const JSZip = require('jszip');

let sodium;
async function getSodium() {
  if (!sodium) {
    sodium = require('libsodium-wrappers-sumo');
    await sodium.ready;
  }
  return sodium;
}

class NaiClient {
  constructor() {
    this.apiEndpoint = 'https://api.novelai.net';
    this.imageEndpoint = 'https://image.novelai.net';
    this.token = null;
  }

  async login(email, password) {
    const s = await getSodium();
    const key = s.crypto_pwhash(
      64,
      new Uint8Array(Buffer.from(password)),
      s.crypto_generichash(
        s.crypto_pwhash_SALTBYTES,
        password.slice(0, 6) + email + 'novelai_data_access_key'
      ),
      2, 2e6,
      s.crypto_pwhash_ALG_ARGON2ID13,
      'base64'
    ).slice(0, 64);

    const res = await fetch(this.apiEndpoint + '/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data = await res.json();
    this.token = data.accessToken;
    return data;
  }

  async getCredits() {
    if (!this.token) throw new Error('Not logged in');
    const res = await fetch(this.apiEndpoint + '/user/data', {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Credits check failed: ${res.status}`);
    const data = await res.json();
    const steps = data.subscription.trainingStepsLeft;
    return steps.fixedTrainingStepsLeft + steps.purchasedTrainingSteps;
  }

  translateModel(model, version) {
    const modelMap = {
      anime: `nai-diffusion-${version}`,
      inpaint: `nai-diffusion-${version}-inpainting`,
      i2i: `nai-diffusion-${version}`,
    };
    let result = modelMap[model] || `nai-diffusion-${version}`;
    if (version === '4-curated' && (model === 'anime' || model === 'i2i')) {
      result += '-preview';
    }
    return result;
  }

  async generateImage(params, config = {}) {
    if (!this.token) throw new Error('Not logged in');

    const modelVersion = config.modelVersion || '4-5-full';
    const modelValue = this.translateModel(params.model || 'anime', modelVersion);
    const seed = params.seed ?? Math.floor(Math.random() * 2100000000) + 1;

    let action;
    switch (params.model) {
      case 'inpaint': action = 'infill'; break;
      case 'i2i': action = 'img2img'; break;
      default: action = 'generate'; break;
    }

    const body = {
      input: params.prompt,
      model: modelValue,
      action: action,
      parameters: {
        params_version: 3,
        width: params.resolution.width,
        height: params.resolution.height,
        noise_schedule: params.noiseSchedule || 'native',
        controlnet_strength: 1,
        dynamic_thresholding: false,
        scale: params.promptGuidance || 5,
        sampler: params.sampling || 'k_euler_ancestral',
        steps: params.steps || 28,
        noise: params.noise || 0,
        seed: seed,
        n_samples: 1,
        ucPreset: 0,
        negative_prompt: params.uc || '',
        strength: params.imageStrength || 0.7,
        qualityToggle: config.disableQuality ? false : true,
        characterPrompts: [],
        use_coords: params.useCoords || false,
        legacy: false,
        legacy_v3_extend: false,
        prefer_brownian: true,
        autoSmea: false,
        legacy_uc: params.legacyPromptConditioning || false,
        inpaintImg2ImgStrength: params.imageStrength || 0.7,
        cfg_rescale: params.cfgRescale || 0,
        add_original_image: params.originalImage ? true : false,
        normalize_reference_strength_multiple: params.normalizeStrength ?? false,
        skip_cfg_above_sigma: null,
        v4_prompt: {
          caption: {
            base_caption: params.prompt,
            char_captions: [],
          },
          use_coords: params.useCoords || false,
          use_order: true,
        },
        v4_negative_prompt: {
          caption: {
            base_caption: params.uc || '',
            char_captions: [],
          },
          legacy_uc: params.legacyPromptConditioning || false,
        },
      },
    };

    // ─── Vibes ───────────────────────────────────────────────────────
    if (params.vibes && params.vibes.length) {
      body.parameters.reference_image_multiple = params.vibes.map(v => v.image);
      body.parameters.reference_strength_multiple = params.vibes.map(v => v.strength);
      if (params.normalizeStrength && params.vibes.length > 1) {
        const sum = body.parameters.reference_strength_multiple.reduce((acc, val) => acc + val, 0);
        if (sum > 0) {
          body.parameters.reference_strength_multiple =
            body.parameters.reference_strength_multiple.map(val => val / sum);
        }
      }
    }

    // ─── Character References (Director References) ──────────────────
    const validCharRefs = (params.characterReferences || []).filter(
      ref => ref.image && ref.image.length > 0
    );
    if (validCharRefs.length) {
      body.parameters.director_reference_images = [];
      body.parameters.director_reference_descriptions = [];
      body.parameters.director_reference_strength_values = [];
      body.parameters.director_reference_secondary_strength_values = [];
      body.parameters.director_reference_information_extracted = [];
      for (const ref of validCharRefs) {
        body.parameters.director_reference_images.push(ref.image);
        body.parameters.director_reference_descriptions.push({
          caption: {
            base_caption: ref.referenceType || 'character',
            char_captions: [],
          },
          legacy_uc: params.legacyPromptConditioning || false,
        });
        body.parameters.director_reference_strength_values.push(ref.strength ?? 0.6);
        body.parameters.director_reference_secondary_strength_values.push(1 - (ref.fidelity ?? 1));
        body.parameters.director_reference_information_extracted.push(ref.info);
      }
    }

    // ─── Image / Mask ────────────────────────────────────────────────
    if (params.image) body.parameters.image = params.image;
    if (params.mask) body.parameters.mask = params.mask;
    if (params.model === 'inpaint') {
      body.parameters.img2img = {
        strength: params.imageStrength || 0.7,
        begin_from_sigma: null,
        noise: 0,
        extra_noise_seed: seed,
        color_correct: true,
      };
      if (params.sampling === 'ddim_v3') {
        body.parameters.sampler = 'k_euler_ancestral';
      }
    }
    if (params.model === 'i2i') {
      body.parameters.img2img = {
        strength: params.imageStrength || 0.7,
        begin_from_sigma: null,
        noise: params.noise || 0,
        extra_noise_seed: seed,
        color_correct: true,
      };
    }

    // ─── Deliberate Euler Ancestral Bug ──────────────────────────────
    if (params.sampling === 'k_euler_ancestral') {
      body.parameters.deliberate_euler_ancestral_bug =
        params.deliberateEulerAncestralBug ?? false;
    }

    // ─── Variety+ ────────────────────────────────────────────────────
    const hasValidCharRef = validCharRefs.length > 0;
    if (params.varietyPlus && !hasValidCharRef) {
      let sigmaCoef;
      switch (modelVersion) {
        case '4-5-full': case '4-5-curated': sigmaCoef = 58; break;
        case '4-full': case '4-curated': sigmaCoef = 19; break;
        default: sigmaCoef = 0; break;
      }
      const defaultPixels = 832 * 1216;
      const resPixels = params.resolution.width * params.resolution.height;
      body.parameters.skip_cfg_above_sigma = sigmaCoef * Math.pow(resPixels / defaultPixels, 0.5);
    } else if (hasValidCharRef) {
      body.parameters.skip_cfg_above_sigma = null;
    }

    // ─── Character Prompts (v4 multi-character) ──────────────────────
    if (params.characterPrompts && params.characterPrompts.length) {
      const center = { x: 0.5, y: 0.5 };
      const charaPos = (index) =>
        params.useCoords ? (params.characterPositions?.[index] ?? center) : center;

      body.parameters.characterPrompts = params.characterPrompts.map(
        (charPrompt, index) => ({
          prompt: charPrompt,
          uc: params.characterUCs?.[index] ?? '',
          center: charaPos(index),
        })
      );
      body.parameters.v4_prompt.caption.char_captions =
        params.characterPrompts.map((charPrompt, index) => ({
          char_caption: charPrompt,
          centers: [charaPos(index)],
        }));
      body.parameters.v4_negative_prompt.caption.char_captions =
        (params.characterUCs || []).map((charUC, index) => ({
          char_caption: charUC,
          centers: [charaPos(index)],
        }));
    }

    // ─── Send request ────────────────────────────────────────────────
    // L8: try/finally로 clearTimeout 보장 — fetch !ok / arrayBuffer/JSZip throw 등 모든 분기에서
    // setTimeout reference 180초 leak 방지.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const res = await fetch(this.imageEndpoint + '/ai/generate-image', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Generate failed: ${res.status} ${errText}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const zip = await JSZip.loadAsync(buffer);
      const entries = Object.keys(zip.files);
      if (!entries.length) throw new Error('Empty zip response');
      // nodebuffer 직접 반환 — caller가 fs.writeFile에 그대로 넘김.
      return await zip.file(entries[0]).async('nodebuffer');
    } finally {
      clearTimeout(timeout);
    }
  }

  async augmentImage(params) {
    if (!this.token) throw new Error('Not logged in');

    const body = {
      image: params.image,
      prompt: params.prompt,
      defry: params.weaken,
      req_type: params.method,
      width: params.width || 832,
      height: params.height || 1216,
    };
    if (params.method !== 'emotion' && params.method !== 'colorize') {
      body.defry = undefined;
      body.prompt = undefined;
    }
    if (params.method === 'emotion') {
      body.prompt = params.emotion + ';;' + (body.prompt || '');
    }

    const res = await fetch(this.imageEndpoint + '/ai/augment-image', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Augment failed: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files);
    if (!entries.length) throw new Error('Empty zip response');
    return await zip.file(entries[entries.length - 1]).async('nodebuffer');
  }

  async encodeVibeImage(params, config = {}) {
    if (!this.token) throw new Error('Not logged in');

    const modelVersion = config.modelVersion || '4-5-full';
    const modelValue = this.translateModel('anime', modelVersion);

    const res = await fetch(this.imageEndpoint + '/ai/encode-vibe', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: params.image,
        model: modelValue,
        information_extracted: params.info,
      }),
    });
    if (!res.ok) throw new Error(`Vibe encode failed: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString('base64');
  }
}

module.exports = { NaiClient };
