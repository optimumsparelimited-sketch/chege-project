import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 196;
const STROKE_WIDTH = 18;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Props {
  percent: number; // 0 to 1+
  spent: number;
  total: number;
  isOver: boolean;
  hideValues?: boolean;
}

export default function BudgetRing({ percent, spent, total, isOver, hideValues }: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    const clamped = Math.min(percent, 1);
    progress.value = withTiming(clamped, {
      duration: 1200,
      easing: Easing.out(Easing.cubic),
    });
  }, [percent]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  const ringColor = isOver ? '#f87171' : '#cf7217';
  const pctDisplay = Math.round(percent * 100);

  return (
    <View style={styles.container}>
      <Svg width={SIZE} height={SIZE}>
        <G rotation="-90" origin={`${SIZE / 2}, ${SIZE / 2}`}>
          {/* Track ring */}
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={STROKE_WIDTH}
            fill="transparent"
          />
          {/* Progress ring */}
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={ringColor}
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            animatedProps={animatedProps}
            strokeLinecap="round"
            fill="transparent"
          />
        </G>
      </Svg>

      <View style={styles.center} pointerEvents="none">
        <Text style={styles.pct}>{pctDisplay}%</Text>
        <Text style={styles.label}>used</Text>
        <Text style={[styles.spent, { color: ringColor }]}>
          {hideValues ? '••••' : spent.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
        </Text>
        <Text style={styles.ofTotal}>
          {hideValues ? '••••' : `of ${total.toLocaleString('en-KE', { maximumFractionDigits: 0 })} KES`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
  },
  pct: {
    fontSize: 42,
    fontWeight: '800' as const,
    color: '#f7faf6',
    fontFamily: 'Inter_700Bold',
    lineHeight: 46,
  },
  label: {
    fontSize: 12,
    color: '#7aaa8a',
    fontFamily: 'Inter_400Regular',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  spent: {
    fontSize: 15,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
  },
  ofTotal: {
    fontSize: 11,
    color: 'rgba(247,250,246,0.5)',
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
});
