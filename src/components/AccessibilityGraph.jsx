import React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';

const AccessibilityGraph = ({ serviceDistribution }) => {
  if (!serviceDistribution || Object.keys(serviceDistribution).length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '0.8rem' }}>
        Click on the map to see service variety.
      </div>
    );
  }

  const data = Object.entries(serviceDistribution).map(([name, val]) => ({
    subject: name.charAt(0).toUpperCase() + name.slice(1),
    A: val.total,
    fullMark: 10,
  }));

  return (
    <div style={{ width: '100%', height: 250, marginTop: '10px', minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#64748b' }} />
          <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
          <Radar
            name="Services"
            dataKey="A"
            stroke="#6366f1"
            fill="#6366f1"
            fillOpacity={0.6}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AccessibilityGraph;