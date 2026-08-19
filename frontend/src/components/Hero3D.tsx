import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** 粒子星群：随时间缓慢旋转 */
function StarField() {
  const points = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 40;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 40;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (points.current) {
      points.current.rotation.y += delta * 0.02;
      points.current.rotation.x += delta * 0.008;
    }
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.06} color="#22d3ee" transparent opacity={0.8} sizeAttenuation />
    </points>
  );
}

/** 中心线框几何体：自转 + 鼠标视差 */
function WireCore() {
  const mesh = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (mesh.current) {
      mesh.current.rotation.x += delta * 0.25;
      mesh.current.rotation.y += delta * 0.35;
      // 鼠标视差
      const { x, y } = state.pointer;
      mesh.current.position.x = THREE.MathUtils.lerp(mesh.current.position.x, x * 0.6, 0.05);
      mesh.current.position.y = THREE.MathUtils.lerp(mesh.current.position.y, y * 0.4, 0.05);
    }
    if (inner.current) {
      inner.current.rotation.x -= delta * 0.5;
      inner.current.rotation.z += delta * 0.3;
    }
  });

  return (
    <group>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[2.2, 1]} />
        <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.5} />
      </mesh>
      <mesh ref={inner}>
        <octahedronGeometry args={[1.1, 0]} />
        <meshBasicMaterial color="#e879f9" wireframe transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

/**
 * 3D 首屏背景。低端设备由父组件切换到 CSS 降级方案，不渲染本组件。
 */
export default function Hero3D() {
  return (
    <div className="absolute inset-0">
      <Canvas camera={{ position: [0, 0, 8], fov: 60 }} dpr={[1, 1.5]}>
        <ambientLight intensity={0.6} />
        <StarField />
        <WireCore />
      </Canvas>
    </div>
  );
}
