// Kho ảnh chân dung chất lượng cao dành cho Fanpage vệ tinh VIPLIKE
const AVATAR_POOLS = {
  women: [
    ...Array.from({ length: 100 }, (_, i) => `https://randomuser.me/api/portraits/women/${i}.jpg`),
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1548142813-c348350df52b?w=500&auto=format&fit=crop&q=80',
  ],
  men: [
    ...Array.from({ length: 100 }, (_, i) => `https://randomuser.me/api/portraits/men/${i}.jpg`),
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=500&auto=format&fit=crop&q=80',
  ],
  business: [
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1534751516642-a171edd26cb0?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1544717305-2782549b5136?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=500&auto=format&fit=crop&q=80',
  ],
};

function getRandomAvatar(preset = 'mix') {
  let list = [];
  if (preset === 'women') list = AVATAR_POOLS.women;
  else if (preset === 'men') list = AVATAR_POOLS.men;
  else if (preset === 'business') list = AVATAR_POOLS.business;
  else list = [...AVATAR_POOLS.women, ...AVATAR_POOLS.men];
  return list[Math.floor(Math.random() * list.length)];
}

if (typeof window !== 'undefined') {
  window.AVATAR_POOLS = AVATAR_POOLS;
  window.getRandomAvatar = getRandomAvatar;
}
