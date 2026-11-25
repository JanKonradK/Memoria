//! Poison-tolerant locking.
//!
//! A panic on one thread while it held a lock "poisons" a std Mutex, and a
//! plain `.lock().unwrap()` then panics every later caller too, so one bug
//! would take the whole app down with it. Every value guarded here stays
//! consistent between statements, so the data is still safe to use.

use std::sync::{Mutex, MutexGuard};

pub trait Locked<T> {
    /// The guard, recovered from a poisoned lock instead of panicking.
    fn locked(&self) -> MutexGuard<'_, T>;
}

impl<T> Locked<T> for Mutex<T> {
    fn locked(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
