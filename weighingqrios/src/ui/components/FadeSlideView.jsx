import React, {useEffect, useRef} from 'react';
import {Animated} from 'react-native';

export default function FadeSlideView({children, delay = 0, distance = 16, style}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(distance)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {toValue: 1, duration: 420, delay, useNativeDriver: true}),
      Animated.timing(translateY, {toValue: 0, duration: 420, delay, useNativeDriver: true}),
    ]).start();
  }, [delay, opacity, translateY]);

  return (
    <Animated.View style={[style, {opacity, transform: [{translateY}]}]}>
      {children}
    </Animated.View>
  );
}
