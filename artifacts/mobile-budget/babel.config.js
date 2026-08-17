module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          unstable_transformImportMeta: true,
          // Force the hermes-v0 transform profile so hermesc (the Hermes
          // bytecode compiler used during `expo export` / `eas update`) always
          // receives ES5-compatible output.
          //
          // Background: react-native 0.81.5 ships new Fabric DOM APIs
          // (DOMRect, ReadOnlyNode, ReactNativeElement, etc.) that use ES6
          // class declarations and private class fields (#x, #y, #width,
          // #height).  The hermesc binary bundled with RN 0.81.5 rejects
          // these with "invalid statement encountered" / "private properties
          // are not supported" errors when bundling for OTA (eas update).
          //
          // hermes-v0 adds @babel/plugin-transform-classes,
          // @babel/plugin-transform-class-properties, and
          // @babel/plugin-transform-private-methods, converting all of the
          // above to prototype-chain code that hermesc compiles without error.
          //
          // The device Hermes runtime (from the APK) is fully compatible with
          // the resulting ES5-style bytecode, so OTA updates work correctly.
          unstable_transformProfile: 'hermes-v0',
        },
      ],
    ],
    plugins: [
      // React Compiler — must be explicit because experiments.reactCompiler in
      // app.json skips auto-injection during expo export / eas build.
      'babel-plugin-react-compiler',
    ],
  };
};
