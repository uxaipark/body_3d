'use client';
import {ArrowUpRight} from 'lucide-react';
import {LabHeader} from '../../simulator-nav';
export default function WristLab(){return <main className="wrist-workspace"><LabHeader active="wrist"/><iframe className="wrist-simulator-frame" title="손목 정전용량 배열 및 손가락 광학 센싱 시뮬레이터" src="/simulators/radial/index.html?theme=dark&wrist3d=A" allow="fullscreen"/><div className="wrist-workspace-footer"><span>모델 설정·추정값·실측 재생을 구분하여 확인하세요.</span><a href="/simulators/radial/index.html?theme=dark&wrist3d=A" target="_blank" rel="noreferrer">실험 화면만 새 창으로<ArrowUpRight size={14}/></a></div></main>}
