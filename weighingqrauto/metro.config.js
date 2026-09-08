const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const config = {
  maxWorkers: 4,          // parallel JS transform workers
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        inlineRequires: true,  // lazy-load modules → faster startup
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
