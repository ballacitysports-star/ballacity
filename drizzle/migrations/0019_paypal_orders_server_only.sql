-- PayPal orders are created only by the server (createGamePayPalOrder), which
-- prices them from the game's settings. Players could previously insert their
-- own rows with any amount and then capture a matching underpriced order.
drop policy if exists "players create own orders" on public.paypal_orders;
revoke insert on public.paypal_orders from authenticated;
