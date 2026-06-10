import { useEffect } from 'react';
import { appState } from '../models/AppService';

// audit D3 — 자체 `fixed inset-0` 다이얼로그(ModalOverlay 컴포넌트 미사용)의 오버레이 div
// 안에 자식으로 렌더하면, 그 오버레이가 화면에 보이는 동안만 mount된다(닫히거나 컴포넌트가
// return null 하면 자식도 사라져 unmount). mount 시 modalOverlayCount +1, unmount 시 -1 →
// ModalOverlay 컴포넌트와 동일하게 App.tsx의 글로벌 드래그드롭 임포트를 차단(modalOverlayCount>0).
// 다이얼로그별 "열림 조건"을 따로 알 필요 없이 오버레이의 자식이라 수명이 정확히 일치한다.
// DOM을 만들지 않으므로(null 반환) 레이아웃/클릭에 영향 없음.
export default function ModalOverlayCountMarker() {
  useEffect(() => {
    appState.incrementModalOverlay();
    return () => appState.decrementModalOverlay();
  }, []);
  return null;
}
