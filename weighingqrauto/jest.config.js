module.exports = {
  preset: 'react-native',
  // The preset transforms .js/.ts/.tsx only; the app's screens are .jsx.
  transform: {
    '^.+\\.jsx$': 'babel-jest',
  },
};
