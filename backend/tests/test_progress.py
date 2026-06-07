import asyncio
from ablebackup.api.progress import ProgressHub


def test_subscriber_receives_published_events():
    async def scenario():
        hub = ProgressHub()
        q = hub.subscribe()
        await hub.publish({"type": "a"})
        await hub.publish({"type": "b"})
        first = await asyncio.wait_for(q.get(), timeout=1)
        second = await asyncio.wait_for(q.get(), timeout=1)
        hub.unsubscribe(q)
        return first, second
    first, second = asyncio.run(scenario())
    assert first == {"type": "a"}
    assert second == {"type": "b"}


def test_mid_run_subscriber_gets_run_history():
    async def scenario():
        hub = ProgressHub()
        await hub.publish({"type": "backup_start", "project_count": 2})
        await hub.publish({"type": "project_start", "project_name": "A"})
        q = hub.subscribe()  # reconnects mid-run -> catches up
        a = await asyncio.wait_for(q.get(), timeout=1)
        b = await asyncio.wait_for(q.get(), timeout=1)
        return a, b
    a, b = asyncio.run(scenario())
    assert a["type"] == "backup_start"
    assert b["type"] == "project_start"


def test_finished_run_is_not_replayed():
    # The fix: a socket connecting AFTER a run finished must NOT see the old run.
    async def scenario():
        hub = ProgressHub()
        await hub.publish({"type": "backup_start", "project_count": 1})
        await hub.publish({"type": "backup_done", "ok_count": 1, "error_count": 0, "skipped_count": 0})
        q = hub.subscribe()
        try:
            await asyncio.wait_for(q.get(), timeout=0.2)
            return False  # got a replayed event -> bug
        except asyncio.TimeoutError:
            return True
    assert asyncio.run(scenario()) is True


def test_multiple_subscribers_each_receive():
    async def scenario():
        hub = ProgressHub()
        q1 = hub.subscribe()
        q2 = hub.subscribe()
        await hub.publish({"type": "x"})
        return (await asyncio.wait_for(q1.get(), 1),
                await asyncio.wait_for(q2.get(), 1))
    r1, r2 = asyncio.run(scenario())
    assert r1 == {"type": "x"} == r2


def test_publish_threadsafe_delivers_to_loop():
    async def scenario():
        hub = ProgressHub()
        loop = asyncio.get_running_loop()
        hub.bind_loop(loop)
        q = hub.subscribe()
        # simulate a worker thread publishing
        await asyncio.to_thread(hub.publish_threadsafe, {"type": "from_thread"})
        return await asyncio.wait_for(q.get(), timeout=1)
    got = asyncio.run(scenario())
    assert got == {"type": "from_thread"}
