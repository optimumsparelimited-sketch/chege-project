import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';

export default function LoginScreen() {
  const { login, isLoading } = useAuth();
  const insets = useSafeAreaInsets();
  const [signingIn, setSigningIn] = React.useState(false);

  async function handleLogin() {
    setSigningIn(true);
    try {
      await login();
    } finally {
      setSigningIn(false);
    }
  }

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#cf7217" />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={['#0a1a10', '#0f2217', '#163020']}
      style={[styles.container, { paddingTop: topPad + 20, paddingBottom: botPad + 24 }]}
    >
      {/* Brand mark */}
      <View style={styles.brandWrap}>
        <View style={styles.iconCircle}>
          <Feather name="trending-up" size={36} color="#cf7217" />
        </View>
        <Text style={styles.appName}>Bajeti</Text>
        <Text style={styles.tagline}>Family finances, together</Text>
      </View>

      {/* Feature list */}
      <View style={styles.features}>
        <FeatureRow icon="bar-chart-2" text="Track every shilling spent" />
        <FeatureRow icon="refresh-cw" text="Log expenses on the go" />
        <FeatureRow icon="users" text="Shared between both of you" />
      </View>

      {/* Sign in button */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.signInBtn,
            pressed && { opacity: 0.85 },
          ]}
          onPress={handleLogin}
          disabled={signingIn}
        >
          {signingIn ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="log-in" size={18} color="#fff" />
              <Text style={styles.signInText}>Sign in to continue</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.disclaimer}>
          Same account as the web app
        </Text>
      </View>
    </LinearGradient>
  );
}

function FeatureRow({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>
        <Feather name={icon} size={16} color="#cf7217" />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f2217',
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  brandWrap: {
    alignItems: 'center',
    marginTop: 40,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(207,114,23,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(207,114,23,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  appName: {
    fontSize: 40,
    fontWeight: '800' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 16,
    color: '#7aaa8a',
    fontFamily: 'Inter_400Regular',
    marginTop: 8,
  },
  features: {
    gap: 16,
    paddingVertical: 20,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(207,114,23,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 15,
    color: '#f7faf6',
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  footer: {
    gap: 12,
    alignItems: 'center',
  },
  signInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#2e6b44',
    borderRadius: 16,
    paddingVertical: 16,
    width: '100%',
  },
  signInText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#fff',
    fontFamily: 'Inter_700Bold',
  },
  disclaimer: {
    fontSize: 13,
    color: '#5c8a6c',
    fontFamily: 'Inter_400Regular',
  },
});
