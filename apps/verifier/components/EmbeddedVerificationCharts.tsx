'use client';
import dynamic from 'next/dynamic';
import {useEmbeddedFluent} from './fluent-embedded';
import type {RecordEntry} from '../lib/evidence';

const Charts=dynamic(()=>import('./VerificationCharts'),{
  ssr:false,
  loading:()=> <p role="status">正在载入统计图…</p>,
});

export function EmbeddedVerificationCharts(props:{records:RecordEntry[];partial:boolean;reduced:boolean}){
  return useEmbeddedFluent()?<Charts {...props}/>:null;
}
