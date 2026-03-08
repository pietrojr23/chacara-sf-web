const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const firebaseCjsEntries = {
  'firebase/app': path.resolve(__dirname, 'node_modules/firebase/app/dist/index.cjs.js'),
  'firebase/firestore': path.resolve(__dirname, 'node_modules/firebase/firestore/dist/index.cjs.js'),
  'firebase/functions': path.resolve(__dirname, 'node_modules/firebase/functions/dist/index.cjs.js'),
  'firebase/storage': path.resolve(__dirname, 'node_modules/firebase/storage/dist/index.cjs.js'),
  '@firebase/app': path.resolve(__dirname, 'node_modules/@firebase/app/dist/index.cjs.js'),
  '@firebase/firestore': path.resolve(__dirname, 'node_modules/@firebase/firestore/dist/index.cjs.js'),
  '@firebase/functions': path.resolve(__dirname, 'node_modules/@firebase/functions/dist/index.cjs.js'),
  '@firebase/storage': path.resolve(__dirname, 'node_modules/@firebase/storage/dist/index.cjs.js'),
};
const nestedRnAuthEntry = path.resolve(__dirname, 'node_modules/firebase/node_modules/@firebase/auth/dist/rn/index.js');
const hoistedRnAuthEntry = path.resolve(__dirname, 'node_modules/@firebase/auth/dist/rn/index.js');
const rnAuthEntry = fs.existsSync(nestedRnAuthEntry) ? nestedRnAuthEntry : hoistedRnAuthEntry;

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isNativePlatform = platform !== 'web';

  if (isNativePlatform && moduleName === 'firebase/auth') {
    return {
      filePath: rnAuthEntry,
      type: 'sourceFile',
    };
  }

  if (isNativePlatform && firebaseCjsEntries[moduleName]) {
    return {
      filePath: firebaseCjsEntries[moduleName],
      type: 'sourceFile',
    };
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
