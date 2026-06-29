/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		fontFamily: {
  			sans: [
  				'"InterVariable"',
  				'Inter',
  				'ui-sans-serif',
  				'system-ui',
  				'-apple-system',
  				'"Segoe UI"',
  				'Roboto',
  				'"Helvetica Neue"',
  				'Arial',
  				'sans-serif'
  			]
  		},
  		colors: {
  			/* Brand navy ramp. The app hard-codes Tailwind palette classes
  			   (bg-blue-600, text-blue-700, indigo gradients) rather than semantic
  			   tokens, so remapping `blue` and `indigo` to navy re-tones the whole
  			   brand at once. `navy` is also exposed for explicit use. */
  			navy: {
  				'50': '#eef3fc',
  				'100': '#d8e3f7',
  				'200': '#b6c9ee',
  				'300': '#88a5e0',
  				'400': '#587ccd',
  				'500': '#3557b0',
  				'600': '#264491',
  				'700': '#213a76',
  				'800': '#1f3261',
  				'900': '#15223f',
  				'950': '#0d1628'
  			},
  			blue: {
  				'50': '#eef3fc',
  				'100': '#d8e3f7',
  				'200': '#b6c9ee',
  				'300': '#88a5e0',
  				'400': '#587ccd',
  				'500': '#3557b0',
  				'600': '#264491',
  				'700': '#213a76',
  				'800': '#1f3261',
  				'900': '#15223f',
  				'950': '#0d1628'
  			},
  			/* Indigo maps to a marginally deeper/cooler navy so existing two-tone
  			   gradients (from-blue-* to-indigo-*) keep subtle depth. */
  			indigo: {
  				'50': '#eef0fb',
  				'100': '#daddf6',
  				'200': '#bbc1ee',
  				'300': '#919ae0',
  				'400': '#6670cf',
  				'500': '#434eb8',
  				'600': '#333c9c',
  				'700': '#2b327e',
  				'800': '#272d66',
  				'900': '#1c1f44',
  				'950': '#121327'
  			},
  			/* Gold accent — intentionally distinct from clinical amber/yellow.
  			   Used sparingly for brand accents (active nav, eyebrows, highlights),
  			   never to signal a warning. */
  			gold: {
  				'50': '#fbf8ec',
  				'100': '#f6eecb',
  				'200': '#eedc98',
  				'300': '#e5c45c',
  				'400': '#dcab35',
  				'500': '#c7901f',
  				'600': '#a8741a',
  				'700': '#855718',
  				'800': '#6e471a',
  				'900': '#5d3c19',
  				'950': '#361f0a'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			'fade-in': {
  				from: {
  					opacity: '0',
  					transform: 'translateY(10px)'
  				},
  				to: {
  					opacity: '1',
  					transform: 'translateY(0)'
  				}
  			},
  			/* Loading-skeleton sheen: a light band sweeps left→right. */
  			sheen: {
  				'100%': {
  					transform: 'translateX(100%)'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'fade-in': 'fade-in 0.4s ease-out',
  			sheen: 'sheen 1.6s infinite'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}