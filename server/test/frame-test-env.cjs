const { randomBytes } = require('node:crypto');

// Settings for the isolated HTTP test process, independent of both local instances.
module.exports = function configureSyntheticFrames() {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.FRAME_TOKEN_SECRET = randomBytes(32).toString('hex');
  process.env.FRAME_RATE_WINDOW_SECONDS = '60';
  for (const modality of ['CR', 'DX', 'US']) process.env['FRAME_RATE_' + modality] = '50';
  for (const modality of ['CT', 'MR']) process.env['FRAME_RATE_' + modality] = '100';
};
